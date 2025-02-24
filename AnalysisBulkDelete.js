const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;
const path = require('path');

// Gmail API scopes
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://mail.google.com/'  // Full access to the account, needed for batch delete
];

// Configuration
const CONFIG = {
  BATCH_SIZE: 100,
  DELETE_BATCH_SIZE: 500,
  RATE_LIMIT: {
    BASE_DELAY: 2000,
    MAX_RETRIES: 5,
    MAX_BACKOFF: 60000,
    QUOTA_RESET_DELAY: 60000,
  },
  DELETE: {
    MAX_FAILED_ATTEMPTS: 3,
    PROGRESS_SAVE_INTERVAL: 1000  // Save progress every 1000 messages
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getGmailClient() {
  console.log('Starting authentication...');
  const auth = await authenticate({
    keyfilePath: '/Users/kurukshetrant/zypherz_workspace/gmail_analysis/client_secret_779943235799-2k4e8l0lnsf0pehndcci54p8m6bl3vk4.apps.googleusercontent.com.json',
    scopes: SCOPES,
  });
  console.log('Authentication successful!');
  return google.gmail({ version: 'v1', auth });
}

async function getAllMessages(gmail) {
  console.log('Fetching all unread messages...');
  let messages = [];
  let nextPageToken = null;
  let pageCount = 0;
  
  try {
    do {
      pageCount++;
      console.log(`Fetching page ${pageCount}...`);
      
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 500,
        pageToken: nextPageToken,
        q: 'is:unread -in:spam -in:trash'
      });

      if (response.data.messages) {
        messages = messages.concat(response.data.messages);
        console.log(`Total messages fetched: ${messages.length}`);
      }

      nextPageToken = response.data.nextPageToken;

      // Add delay every 500 messages to avoid rate limits
      if (messages.length % 500 === 0) {
        console.log('Taking a short break to avoid rate limits...');
        await sleep(1000);
      }

    } while (nextPageToken);

    return messages;

  } catch (error) {
    console.error('Error fetching messages:', error);
    // Save progress if error occurs
    if (messages.length > 0) {
      await saveProgressToFile(messages, 'failed-fetch-progress.json');
    }
    throw error;
  }
}

async function processEmailsInBatches(gmail, emails, senderStats) {
  const batchSize = 100;
  let processedCount = 0;

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, Math.min(i + batchSize, emails.length));
    
    // Process batch with retries
    for (const email of batch) {
      let retries = 3;
      while (retries > 0) {
        try {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id: email.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          });

          const fromHeader = message.data.payload.headers.find(h => h.name === 'From');
          const from = fromHeader ? fromHeader.value : 'Unknown';
          const sender = extractEmailAddress(from);

          if (!senderStats.has(sender)) {
            senderStats.set(sender, {
              count: 0,
              totalSize: 0,
              lastEmail: null
            });
          }

          const stats = senderStats.get(sender);
          stats.count++;
          stats.totalSize += message.data.sizeEstimate || 0;
          stats.lastEmail = message.data.payload.headers.find(h => h.name === 'Date')?.value;
          
          break; // Success, exit retry loop
        } catch (error) {
          retries--;
          if (retries === 0) {
            console.error(`Failed to process email ${email.id} after 3 attempts`);
            throw error;
          }
          await sleep(2000); // Wait 2 seconds before retry
        }
      }
    }

    processedCount += batch.length;
    console.log(`Processed ${processedCount} of ${emails.length} emails`);
    
    // Save progress periodically
    if (processedCount % 1000 === 0) {
      await saveProgressToFile(Array.from(senderStats.entries()), 'analysis-progress.json');
    }

    // Delay between batches
    await sleep(1000);
  }
}

async function analyzeEmailsBySender() {
  try {
    console.log('Getting Gmail client...');
    const gmail = await getGmailClient();
    
    console.log('Fetching all messages...');
    const emails = await getAllMessages(gmail);
    console.log(`Total messages to process: ${emails.length}`);

    const senderStats = new Map();
    await processEmailsInBatches(gmail, emails, senderStats);

    // Convert to array and sort
    const sortedStats = Array.from(senderStats.entries())
      .sort((a, b) => b[1].count - a[1].count);

    // Write to CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csvFilename = `email-analysis-${timestamp}.csv`;
    
    // Prepare CSV content
    const csvContent = ['senderEmail,totalEmailCount,totalSize,lastEmail'];
    sortedStats.forEach(([sender, stats]) => {
      csvContent.push(`"${sender}",${stats.count},${(stats.totalSize / 1024 / 1024).toFixed(2)},"${stats.lastEmail}"`);
    });

    // Write CSV file
    await fs.writeFile(csvFilename, csvContent.join('\n'));
    console.log(`Analysis written to ${csvFilename}`);

    return csvFilename;

  } catch (error) {
    console.error('Error analyzing emails:', error);
    throw error;
  }
}

async function saveProgressToFile(data, filename) {
  await fs.writeFile(filename, JSON.stringify(data, null, 2));
  console.log(`Progress saved to ${filename}`);
}

function extractEmailAddress(fromString) {
  const match = fromString.match(/<(.+)>/);
  return match ? match[1] : fromString.trim();
}

async function bulkDeleteFromSender(gmail, sender) {
  console.log(`\nDeleting ALL messages from ${sender}...`);
  let deletedCount = 0;
  let nextPageToken = null;
  let failedAttempts = 0;
  const maxFailedAttempts = 3;

  try {
    do {
      try {
        // Get batch of message IDs
        const response = await retryWithExponentialBackoff(async () => {
          return await gmail.users.messages.list({
            userId: 'me',
            maxResults: CONFIG.DELETE_BATCH_SIZE,
            q: `from:${sender} is:unread`,
            pageToken: nextPageToken,
            fields: 'messages/id,nextPageToken,resultSizeEstimate'
          });
        });

        const messages = response.data.messages || [];
        if (messages.length === 0) {
          console.log('No more messages to delete');
          break;
        }

        // Log estimated remaining messages
        if (response.data.resultSizeEstimate) {
          console.log(`Estimated remaining messages: ${response.data.resultSizeEstimate}`);
        }

        // Delete the batch
        await retryWithExponentialBackoff(async () => {
          await gmail.users.messages.batchDelete({
            userId: 'me',
            requestBody: {
              ids: messages.map(msg => msg.id)
            }
          });
        });

        deletedCount += messages.length;
        console.log(`Progress: Deleted ${deletedCount} messages from ${sender}`);
        
        // Reset failed attempts on successful deletion
        failedAttempts = 0;
        
        nextPageToken = response.data.nextPageToken;

        // Add delay between batches to avoid rate limits
        await sleep(CONFIG.RATE_LIMIT.BASE_DELAY);

      } catch (batchError) {
        failedAttempts++;
        console.error(`Batch deletion error (attempt ${failedAttempts}/${maxFailedAttempts}):`, batchError.message);
        
        if (failedAttempts >= maxFailedAttempts) {
          throw new Error(`Failed to delete batch after ${maxFailedAttempts} attempts`);
        }
        
        // Wait longer after a failed attempt
        await sleep(CONFIG.RATE_LIMIT.BASE_DELAY * 2);
      }
    } while (nextPageToken);

    console.log(`\nCompleted deletion for ${sender}`);
    console.log(`Total messages deleted: ${deletedCount}`);
    return deletedCount;

  } catch (error) {
    console.error(`Fatal error deleting emails from ${sender}:`, error);
    return deletedCount;
  }
}

async function retryWithExponentialBackoff(operation, retryCount = 0) {
  try {
    return await operation();
  } catch (error) {
    const isQuotaError = error.message && (
      error.message.includes('Resource has been exhausted') ||
      error.message.includes('Quota exceeded')
    );
    
    if (isQuotaError && retryCount < CONFIG.RATE_LIMIT.MAX_RETRIES) {
      const delay = error.message.includes('Quota exceeded')
        ? CONFIG.RATE_LIMIT.QUOTA_RESET_DELAY
        : Math.min(
            CONFIG.RATE_LIMIT.BASE_DELAY * Math.pow(2, retryCount),
            CONFIG.RATE_LIMIT.MAX_BACKOFF
          );
      
      console.log(`Rate limit hit. Waiting ${delay/1000} seconds before retry ${retryCount + 1}/${CONFIG.RATE_LIMIT.MAX_RETRIES}...`);
      await sleep(delay);
      return retryWithExponentialBackoff(operation, retryCount + 1);
    }
    throw error;
  }
}

async function bulkDeleteFromEmailList(emailList, maxMessagesPerSender = null) {
  try {
    console.log('Starting bulk delete process...');
    const gmail = await getGmailClient();
    
    let totalDeleted = 0;
    const deleteStats = new Map();
    
    // Read email list from file if string is provided
    if (typeof emailList === 'string') {
      const content = await fs.readFile(emailList, 'utf8');
      emailList = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
    }

    console.log(`Processing ${emailList.length} email addresses...`);

    for (const email of emailList) {
      if (!email) continue;
      
      console.log(`\nProcessing ${email}...`);
      const deletedCount = await bulkDeleteFromSender(gmail, email);
      totalDeleted += deletedCount;
      deleteStats.set(email, deletedCount);

      // Save progress after each email
      await saveProgressToFile({
        totalDeleted,
        lastProcessedEmail: email,
        deleteStats: Object.fromEntries(deleteStats),
        timestamp: new Date().toISOString()
      }, 'delete-progress.json');

      // Add delay between senders
      await sleep(CONFIG.RATE_LIMIT.BASE_DELAY);
    }

    // Generate deletion report
    const reportContent = ['email,deletedCount'];
    deleteStats.forEach((count, email) => {
      reportContent.push(`"${email}",${count}`);
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = `deletion-report-${timestamp}.csv`;
    await fs.writeFile(reportFile, reportContent.join('\n'));

    console.log('\nDeletion process complete!');
    console.log(`Total emails deleted: ${totalDeleted}`);
    console.log(`Report saved to: ${reportFile}`);

    return {
      totalDeleted,
      reportFile,
      deleteStats
    };

  } catch (error) {
    console.error('Error in bulk delete process:', error);
    throw error;
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length > 0 && args[0] === '--delete') {
      // Delete mode
      const emailListFile = args[1];
      const maxMessagesPerSender = args[2] ? parseInt(args[2]) : null;
      
      if (!emailListFile) {
        console.error('Please provide an email list file path.');
        console.log('Usage: node Analysis90k.js --delete <email-list-file> [max-messages-per-sender]');
        return;
      }

      console.log('Starting bulk delete operation...');
      await bulkDeleteFromEmailList(emailListFile, maxMessagesPerSender);
    } else {
      // Analysis mode
      console.log('Starting large-scale email analysis...');
      const csvFile = await analyzeEmailsBySender();
      console.log('Analysis complete!');
    }
  } catch (error) {
    console.error('Error in main:', error);
  }
}

main();