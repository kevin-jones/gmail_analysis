# Gmail Analysis and Deletion Script

This Node.js script provides functionality to analyze and bulk delete Gmail messages. It can analyze your inbox to generate statistics about senders and selectively delete emails from specific senders.

## Features

- **Email Analysis**: Generate statistics about email senders including:
  - Total email count per sender
  - Total size of emails per sender
  - Last email received date
- **Bulk Deletion**: Delete emails from specific senders with:
  - Batch processing to handle large volumes
  - Progress tracking and checkpointing
  - Rate limit handling
  - Detailed deletion reports

## Prerequisites

1. Node.js (v12 or higher)
2. Gmail API credentials
3. Required npm packages:
   ```bash
   npm install googleapis @google-cloud/local-auth
   ```

## Setup

1. **Create a Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Enable the Gmail API for your project

2. **Get API Credentials**:
   - In Google Cloud Console, go to "Credentials"
   - Create an OAuth 2.0 Client ID
   - Download the client configuration file
   - Rename it to `client_secret.json` and place it in your project directory

3. **Configure the Script**:
   - Update the `keyfilePath` in the script to point to your client secret file
   - Adjust the `CONFIG` settings if needed (batch sizes, delays, etc.)

## Usage

### 1. Email Analysis Mode

Run the script without arguments to analyze your inbox:

```bash
node AnalysisBulkDelete.js
```

This will:
- Generate statistics about all senders in your inbox
- Create a CSV file with the analysis results
- The CSV will include sender email, message count, total size, and last email date

### 2. Email Deletion Mode

To delete emails from specific senders:

1. Create a text file (e.g., `emails-to-delete.txt`) containing email addresses:
   ```text
   sender1@example.com
   sender2@example.com
   # Comments are supported
   sender3@example.com
   ```

2. Run the deletion command:
   ```bash
   node AnalysisBulkDelete.js --delete emails-to-delete.txt
   ```

### Output Files

The script generates several files:

1. **Analysis Mode**:
   - `email-analysis-{timestamp}.csv`: Sender statistics

2. **Delete Mode**:
   - `delete-progress.json`: Checkpoint file for deletion progress
   - `deletion-report-{timestamp}.csv`: Final deletion report

## Configuration

Key configuration options in `CONFIG` object:

```javascript
const CONFIG = {
  BATCH_SIZE: 100,          // Messages per batch for analysis
  DELETE_BATCH_SIZE: 500,   // Messages per batch for deletion
  RATE_LIMIT: {
    BASE_DELAY: 2000,       // Base delay between requests (ms)
    MAX_RETRIES: 5,         // Maximum retry attempts
    MAX_BACKOFF: 60000,     // Maximum backoff time (ms)
    QUOTA_RESET_DELAY: 60000 // Delay when quota exceeded (ms)
  }
};
```

## Error Handling

The script includes robust error handling:
- Automatic retry with exponential backoff for rate limits
- Progress saving for crash recovery
- Detailed error logging

## Progress Tracking

- Progress is saved regularly during both analysis and deletion
- If the script is interrupted, it can resume from the last checkpoint
- Detailed logs show current progress and estimated remaining work

## Best Practices

1. **Before Deletion**:
   - Always run analysis mode first to understand your inbox
   - Review the analysis CSV before deleting
   - Start with a small set of senders to test

2. **During Operation**:
   - Monitor the console output for progress
   - Keep the terminal open during operation
   - Don't interrupt the script unless necessary

3. **Rate Limits**:
   - The script handles Gmail API quotas automatically
   - For large inboxes, the process might take several hours
   - Let the script handle retries automatically

## Troubleshooting

1. **Authentication Issues**:
   - Delete the token file (usually in ~/.credentials)
   - Re-run the script to re-authenticate

2. **Rate Limit Errors**:
   - The script will automatically handle these
   - Wait for the automatic retry
   - If persistent, increase the BASE_DELAY in CONFIG

3. **Permission Errors**:
   - Ensure you've granted all required permissions
   - Re-authenticate if needed

## Safety Features

- Dry-run mode available (comment out actual deletion)
- Progress saving prevents duplicate deletions
- Confirmation prompts for dangerous operations

## Limitations

- Gmail API quotas may limit processing speed
- Large inboxes may take several hours to process
- Maximum of 500 messages per batch deletion

## License

MIT License - Feel free to modify and use as needed. 