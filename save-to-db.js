#!/usr/bin/env node

const { Level } = require('level');
const path = require('path');
const fs = require('fs');

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: node save-to-db.js <path-to-leveldb> <path-to-json-file> [entry-number]');
  console.log('Example: node save-to-db.js ./my-database entry-63-value-formatted.json 63');
  process.exit(1);
}

const dbPath = args[0];
const jsonFilePath = args[1];
const targetEntryNumber = args[2] ? parseInt(args[2]) : 63;

// Check if paths exist
if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database path '${dbPath}' does not exist`);
  process.exit(1);
}

if (!fs.existsSync(jsonFilePath)) {
  console.error(`Error: JSON file '${jsonFilePath}' does not exist`);
  process.exit(1);
}

async function saveToLevelDB(dbPath, jsonFilePath, targetEntryNumber) {
  console.log(`Saving JSON to LevelDB...`);
  console.log(`Database: ${path.resolve(dbPath)}`);
  console.log(`JSON file: ${path.resolve(jsonFilePath)}`);
  console.log(`Target entry: #${targetEntryNumber}`);
  console.log('=' .repeat(60));
  
  let db;
  try {
    // Read and validate the JSON file
    const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
    let jsonData;
    
    try {
      jsonData = JSON.parse(jsonContent);
      console.log(`✅ JSON file validated successfully`);
      console.log(`JSON has ${Object.keys(jsonData).length} top-level properties`);
    } catch (parseError) {
      console.error(`❌ Invalid JSON file: ${parseError.message}`);
      process.exit(1);
    }
    
    // Open the database
    db = new Level(dbPath, { valueEncoding: 'buffer', keyEncoding: 'buffer' });
    console.log('Database opened successfully\n');
    
    let count = 0;
    let targetKey = null;
    
    // First, find the key for the target entry
    console.log(`🔍 Finding key for entry #${targetEntryNumber}...`);
    for await (const [key, value] of db.iterator()) {
      count++;
      
      if (count === targetEntryNumber) {
        targetKey = key;
        const keyStr = key.toString('utf8');
        console.log(`Found target entry #${count}`);
        console.log(`Key: "${keyStr}"`);
        break;
      }
    }
    
    if (!targetKey) {
      console.error(`❌ Entry #${targetEntryNumber} not found in database`);
      process.exit(1);
    }
    
    // Prepare the value to save
    // Add the control character prefix that was in the original
    const jsonString = JSON.stringify(jsonData);
    const valueToSave = '\x01' + jsonString; // Add the 0x01 prefix back
    const valueBuffer = Buffer.from(valueToSave, 'utf8');
    
    console.log(`\n💾 Saving updated JSON...`);
    console.log(`Original JSON length: ${jsonString.length} characters`);
    console.log(`Buffer length (with prefix): ${valueBuffer.length} bytes`);
    
    // Save the updated value
    await db.put(targetKey, valueBuffer);
    
    console.log(`✅ Successfully saved updated JSON to entry #${targetEntryNumber}`);
    
    // Verify the save by reading it back
    console.log(`\n🔍 Verifying save...`);
    const savedValue = await db.get(targetKey);
    const savedValueStr = savedValue.toString('utf8');
    
    // Remove the control character prefix and parse
    const cleanSavedValue = savedValueStr.substring(1);
    const savedJsonData = JSON.parse(cleanSavedValue);
    
    console.log(`✅ Verification successful!`);
    console.log(`Saved JSON has ${Object.keys(savedJsonData).length} top-level properties`);
    
    // Create a backup of what was actually saved
    const backupFilename = `entry-${targetEntryNumber}-saved-backup.json`;
    fs.writeFileSync(backupFilename, JSON.stringify(savedJsonData, null, 2));
    console.log(`💾 Created backup of saved data: ${backupFilename}`);
    
  } catch (error) {
    console.error('Error saving to LevelDB:', error.message);
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

// Start the save process
saveToLevelDB(dbPath, jsonFilePath, targetEntryNumber).catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
