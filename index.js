#!/usr/bin/env node

const { Level } = require('level');
const path = require('path');
const fs = require('fs');

// Get command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node index.js <path-to-leveldb>');
  console.log('Example: node index.js ./my-database');
  process.exit(1);
}

const dbPath = args[0];

// Check if the path exists
if (!fs.existsSync(dbPath)) {
  console.error(`Error: Path '${dbPath}' does not exist`);
  process.exit(1);
}

// Function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to safely convert buffer to string
function bufferToString(buffer, maxLength = 100) {
  if (!Buffer.isBuffer(buffer)) {
    return String(buffer);
  }
  
  // Try to convert to UTF-8 string
  try {
    const str = buffer.toString('utf8');
    // Check if it contains mostly printable characters
    const printableChars = str.split('').filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126;
    }).length;
    
    if (printableChars / str.length > 0.8) {
      return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }
  } catch (e) {
    // Fall back to hex if UTF-8 conversion fails
  }
  
  // Show as hex for binary data
  const hexStr = buffer.toString('hex');
  return hexStr.length > maxLength ? hexStr.substring(0, maxLength) + '...' : hexStr;
}

async function readLevelDB(dbPath) {
  console.log(`Reading LevelDB from: ${path.resolve(dbPath)}`);
  console.log('=' .repeat(60));
  
  let db;
  try {
    // Open the database
    db = new Level(dbPath, { valueEncoding: 'buffer', keyEncoding: 'buffer' });
    
    console.log('Database opened successfully\n');
    
    let count = 0;
    let totalKeySize = 0;
    let totalValueSize = 0;
    
    // Iterate through all key-value pairs
    const targetEntryNumber = 63;
    let foundMatch = false;
    
    for await (const [key, value] of db.iterator()) {
      count++;
      totalKeySize += key.length;
      totalValueSize += value.length;
      
      const keyStr = key.toString('utf8');
      
      // Check if this is entry #63
      if (count === targetEntryNumber) {
        foundMatch = true;
        console.log('\n🔍 FOUND TARGET ENTRY:');
        console.log(`Entry #${count}`);
        console.log(`Key: "${keyStr}"`);
        console.log(`Key Length: ${key.length} bytes`);
        console.log(`Key (trimmed): "${keyStr.trim()}"`);
        console.log(`Key starts with BOM: ${keyStr.charCodeAt(0) === 0xFEFF ? 'Yes' : 'No'}`);
        
        // Show first few bytes of key in hex to debug encoding issues
        const keyHex = key.toString('hex').substring(0, 60);
        console.log(`Key (first 30 bytes hex): ${keyHex}`);
        
        const valueUtf8 = value.toString('utf8');
        console.log(`Value Length: ${value.length} bytes`);
        console.log(`Value starts with BOM: ${valueUtf8.charCodeAt(0) === 0xFEFF ? 'Yes' : 'No'}`);
        
        // Show first few bytes in hex to see what we're dealing with
        const firstBytes = value.subarray(0, 10);
        console.log(`First 10 bytes (hex): ${firstBytes.toString('hex')}`);
        console.log(`First 10 characters (codes): ${Array.from(valueUtf8.substring(0, 10)).map(c => c.charCodeAt(0)).join(' ')}`);
        
        // More aggressive cleaning - handle various BOMs and control characters
        let cleanValue = valueUtf8;
        
        // Remove UTF-8 BOM (EF BB BF)
        if (cleanValue.charCodeAt(0) === 0xFEFF) {
          cleanValue = cleanValue.substring(1);
          console.log(`Removed UTF-8 BOM (U+FEFF)`);
        }
        
        // Remove UTF-16 BE BOM (FE FF)
        if (cleanValue.charCodeAt(0) === 0xFFFE) {
          cleanValue = cleanValue.substring(1);
          console.log(`Removed UTF-16 BE BOM (U+FFFE)`);
        }
        
        // Remove leading control characters (0x00-0x1F except newline/tab) and whitespace
        const originalLength = cleanValue.length;
        cleanValue = cleanValue.replace(/^[\x00-\x08\x0B-\x0C\x0E-\x1F\s\uFEFF\u200B\u200C\u200D\u2060]+/, '');
        if (cleanValue.length !== originalLength) {
          console.log(`Removed ${originalLength - cleanValue.length} leading control characters/whitespace`);
        }
        
        // If it still doesn't start with '{' or '[', try to find where JSON actually starts
        if (!cleanValue.startsWith('{') && !cleanValue.startsWith('[')) {
          const jsonStart = cleanValue.search(/[{\[]/);
          if (jsonStart > 0) {
            const removedPrefix = cleanValue.substring(0, jsonStart);
            cleanValue = cleanValue.substring(jsonStart);
            console.log(`Found JSON starting at position ${jsonStart}, removed prefix: ${Array.from(removedPrefix).map(c => c.charCodeAt(0)).join(' ')}`);
          }
        }
        
        // Show what we have after cleaning
        console.log(`After cleaning - First 10 characters (codes): ${Array.from(cleanValue.substring(0, 10)).map(c => c.charCodeAt(0)).join(' ')}`);
        console.log(`First 100 characters after cleaning: ${cleanValue.substring(0, 100)}`);
        
        // Try to parse as JSON
        try {
          const jsonData = JSON.parse(cleanValue);
          console.log(`\n✅ Successfully parsed JSON!`);
          console.log(`JSON has ${Object.keys(jsonData).length} top-level properties`);
          
          // Show the structure
          console.log(`\n📋 JSON Structure:`);
          for (const [key, value] of Object.entries(jsonData)) {
            const valueType = Array.isArray(value) ? `array[${value.length}]` : typeof value;
            console.log(`  ${key}: ${valueType}`);
          }
          
          // Check if it contains "bot-ai-button" in the JSON
          const jsonStr = JSON.stringify(jsonData, null, 2);
          if (jsonStr.includes("bot-ai-button")) {
            const position = jsonStr.indexOf("bot-ai-button");
            console.log(`\n⭐ Found "bot-ai-button" at position ${position} in the JSON`);
            
            // Show context around the match
            const start = Math.max(0, position - 200);
            const end = Math.min(jsonStr.length, position + 113 + 200);
            const context = jsonStr.substring(start, end);
            console.log(`Context:\n${context}`);
          }
          
          // Save both raw and formatted JSON
          const filenameRaw = `entry-63-value-raw.txt`;
          const filenameJson = `entry-63-value-formatted.json`;
          
          fs.writeFileSync(filenameRaw, cleanValue);
          fs.writeFileSync(filenameJson, JSON.stringify(jsonData, null, 2));
          
          console.log(`\n💾 Saved raw value to: ${filenameRaw}`);
          console.log(`💾 Saved formatted JSON to: ${filenameJson}`);
          console.log(`📄 Raw file size: ${formatBytes(cleanValue.length)}`);
          console.log(`📄 Formatted JSON size: ${formatBytes(JSON.stringify(jsonData, null, 2).length)}`);
          
        } catch (parseError) {
          console.log(`\n❌ Failed to parse as JSON: ${parseError.message}`);
          console.log(`Value (first 500 chars):\n${cleanValue.substring(0, 500)}`);
          
          // Save raw value anyway
          const filename = `entry-63-value.txt`;
          fs.writeFileSync(filename, cleanValue);
          console.log(`\n💾 Saved raw value to file: ${filename}`);
          console.log(`📄 File size: ${formatBytes(cleanValue.length)}`);
        }
        
        break; // Exit the loop since we found our target
      }
    }
    
    console.log('=' .repeat(60));
    console.log('Database Summary:');
    console.log(`Total entries scanned: ${count}`);
    console.log(`Target entry #${targetEntryNumber} found: ${foundMatch ? 'Yes' : 'No'}`);
    console.log(`Total key size: ${formatBytes(totalKeySize)}`);
    console.log(`Total value size: ${formatBytes(totalValueSize)}`);
    console.log(`Total size: ${formatBytes(totalKeySize + totalValueSize)}`);
    
    if (!foundMatch) {
      console.log(`\n❌ Entry #${targetEntryNumber} not found in database (only ${count} entries total)`);
    }
    
  } catch (error) {
    console.error('Error reading LevelDB:', error.message);
    
    // Check if it's a corruption error and suggest repair
    if (error.message.includes('Corruption') || error.message.includes('corruption')) {
      console.log('\nThe database appears to be corrupted.');
      console.log('You may need to repair it or it might not be a valid LevelDB.');
    } else if (error.message.includes('does not exist')) {
      console.log('\nThe specified path does not contain a valid LevelDB.');
      console.log('Make sure the path points to a LevelDB directory.');
    }
    
    process.exit(1);
  } finally {
    // Close the database
    if (db) {
      try {
        await db.close();
        console.log('\nDatabase closed successfully');
      } catch (closeError) {
        console.error('Error closing database:', closeError.message);
      }
    }
  }
}

// Add some basic options parsing
const options = {
  help: false,
  version: false
};

// Parse options
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    options.help = true;
  } else if (arg === '--version' || arg === '-v') {
    options.version = true;
  }
}

if (options.help) {
  console.log('LevelDB Reader CLI Tool');
  console.log('Usage: node index.js [options] <path-to-leveldb>');
  console.log('');
  console.log('Options:');
  console.log('  -h, --help     Show this help message');
  console.log('  -v, --version  Show version');
  console.log('');
  console.log('Examples:');
  console.log('  node index.js ./my-database');
  console.log('  node index.js /path/to/leveldb/data');
  process.exit(0);
}

if (options.version) {
  console.log('LevelDB Reader v1.0.0');
  process.exit(0);
}

// Find the database path (should be the last non-option argument)
const dbPathIndex = args.findIndex(arg => !arg.startsWith('-'));
if (dbPathIndex === -1) {
  console.error('Error: No database path provided');
  console.log('Use --help for usage information');
  process.exit(1);
}

const finalDbPath = args[dbPathIndex];

// Start reading the database
readLevelDB(finalDbPath).catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});