/**
 * @import-af/qbo-monday
 * Synchronization utilities between QuickBooks Online and Monday.com
 */

const version = '1.0.0';

/**
 * Test function for @import-af/qbo-monday
 * @returns {string} Hello message
 */
function hello() {
  return 'Hello from @import-af/qbo-monday!';
}


/**
 * Parse JSON configuration for QBO-Monday sync
 * @param {string} jsonString - Configuration JSON
 * @returns {Object} Parsed configuration
 */
function parseConfig(jsonString) {
  try {
    const config = JSON.parse(jsonString);
    // TODO: Add validation logic
    return config;
  } catch (error) {
    throw new Error('Invalid JSON configuration: ' + error.message);
  }
}

module.exports = {
  version,
  hello,
  // TODO: Add your QBO-Monday sync functions here
  // parseConfig,
  // syncQboToMonday,
  // syncMondayToQbo
};
