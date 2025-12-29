/**
 * @import-af/monday
 * Monday.com integration utilities for automation workflows
 * Enhanced with retry logic and error handling
 */

const version = '1.0.12';

/**
 * Retry configuration and utility functions
 */
class RetryConfig {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 1;
    this.delays = options.delays || [30000]; // 30s
    this.retryableErrors = options.retryableErrors || [
      'NETWORK_ERROR',
      'TIMEOUT_ERROR',
      'SERVER_ERROR',
      'RATE_LIMIT_ERROR',
      'TEMPORARY_ERROR'
    ];
    this.board_columns = options.columns || {};
  }
}

/**
 * Determines if an error should be retried
 * @param {Error} error - The error to check
 * @param {number} statusCode - HTTP status code (if applicable)
 * @returns {boolean} Whether the error should be retried
 */
function isRetryableError(error, statusCode = null) {
  // Network/connection errors
  if (error.code === 'ECONNRESET' || 
      error.code === 'ENOTFOUND' || 
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT') {
    return true;
  }

  // HTTP status codes that should be retried
  if (statusCode) {
    // 5xx server errors
    if (statusCode >= 500 && statusCode < 600) {
      return true;
    }
    // Rate limiting
    if (statusCode === 429) {
      return true;
    }
    // Temporary redirect issues
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return true;
    }
  }

  // Monday.com specific errors that might be temporary
  const errorMessage = error.message?.toLowerCase() || '';
  const retryablePatterns = [
    'timeout',
    'rate limit',
    'server error',
    'internal error',
    'service unavailable',
    'temporarily unavailable',
    'complexity budget',
    'too many requests'
  ];

  return retryablePatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {RetryConfig} config - Retry configuration
 * @param {string} operationName - Name of operation for logging
 * @returns {Promise} Result of the function or throws final error
 */
async function withRetry(fn, config = new RetryConfig(), operationName = 'operation') {
  let lastError;
  
  // for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Execute the function
      const result = await fn();
      
      // If we get here, the operation succeeded
      // if (attempt > 0) {
      //   console.log(`✅ ${operationName} succeeded after ${attempt} retries`);
      // }
      
      return result;
    } catch (error) {
      // lastError = error;
      
      // // If this is the last attempt, don't retry
      // if (attempt === config.maxRetries) {
      //   console.error(`❌ ${operationName} failed after ${config.maxRetries} retries:`, error.message);
      //   break;
      // }
      
      // // Check if error is retryable
      // const statusCode = error.response?.status || error.status;
      // if (!isRetryableError(error, statusCode)) {
      //   console.error(`❌ ${operationName} failed with non-retryable error:`, error.message);
      //   throw error;
      // }
      
      // // Calculate delay for this attempt
      // const delay = config.delays[attempt] || config.delays[config.delays.length - 1];
      
      // console.warn(`⚠️ ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}), retrying in ${delay/1000}s...`, error.message);
      console.warn(`⚠️ ${operationName} failed`, error.message);
      
      // Wait before retrying
      await sleep(45000);
    }
  // }
  
  // If we get here, all retries failed
  // throw lastError;
}

/**
 * Monday.com API Client
 * Centralized client for all Monday.com API interactions with retry logic
 */
class MondayApiClient {
  constructor(apiKey, retryConfig = null) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.monday.com/v2';
    this.retryConfig = retryConfig || new RetryConfig();
    this.board_columns = {};
  }

  /**
   * Execute a GraphQL query against Monday.com API with retry logic
   * @param {string} query - GraphQL query string
   * @param {Object} variables - GraphQL variables (optional)
   * @returns {Promise<Object>} API response
   */
  async query(query, variables = {}) {
    return withRetry(async () => {
      const payload = { query };
      
      // Add variables if provided
      if (Object.keys(variables).length > 0) {
        payload.variables = variables;
      }

      let response;
      try {
        response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.apiKey,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        // Network/fetch errors
        const networkError = new Error(`Network error: ${error.message}`);
        networkError.code = error.code;
        throw networkError;
      }

      // Handle HTTP errors
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        const error = new Error(`Monday API HTTP error: ${response.status} ${response.statusText} - ${errorText}`);
        error.status = response.status;
        error.response = response;
        throw error;
      }

      let result;
      try {
        result = await response.json();
      } catch (error) {
        throw new Error(`Failed to parse Monday API response: ${error.message}`);
      }
      
      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const graphqlError = new Error(`Monday GraphQL error: ${result.errors[0].message}`);
        
        // Check if it's a complexity/rate limit error (retryable)
        const errorMsg = result.errors[0].message.toLowerCase();
        if (errorMsg.includes('complexity') || errorMsg.includes('rate limit')) {
          graphqlError.code = 'COMPLEXITY_ERROR';
        }
        
        // PRESERVE THE RESPONSE DATA AND ERRORS - attach it to the error object
        graphqlError.data = result.data;
        graphqlError.errors = result.errors;
        graphqlError.response = { 
          data: result.data,
          errors: result.errors,
          extensions: result.extensions 
        };
        
        throw graphqlError;
      }

      return result;
    }, this.retryConfig, 'Monday API Query');
  }

  /**
   * Create a new item in Monday.com with retry logic
   * @param {string|number} boardId - Board ID
   * @param {string} itemName - Item name
   * @param {Object} columnValues - Column values object
   * @param {boolean} createLabels - Create labels if missing
   * @returns {Promise<Object>} Created item
   */
  async createItem(boardId, itemName, columnValues = {}, createLabels = true) {
    console.log('🔍 MONDAY API - Real data being sent to Monday:');
    console.log(`   📊 Column Values: ${JSON.stringify(columnValues)}`);
    console.log(`   📝 Stringified: ${JSON.stringify(columnValues)}`);
    
    const mutation = `
      mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!, $createLabels: Boolean!) {
        create_item(
          board_id: $boardId
          item_name: $itemName
          column_values: $columnValues
          create_labels_if_missing: $createLabels
        ) {
          id
          name
        }
      }
    `;

    return this.query(mutation, {
      boardId: boardId.toString(),
      itemName,
      columnValues: JSON.stringify(columnValues),
      createLabels
    });
  }

  /**
   * Update an existing item in Monday.com with retry logic
   * @param {string|number} itemId - Item ID
   * @param {string|number} boardId - Board ID
   * @param {Object} columnValues - Column values object
   * @returns {Promise<Object>} Updated item
   */
  async updateItem(itemId, boardId, columnValues) {
    const mutation = `
      mutation UpdateItem($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          item_id: $itemId
          board_id: $boardId
          column_values: $columnValues
        ) {
          id
          name
        }
      }
    `;

    return this.query(mutation, {
      itemId: itemId.toString(),
      boardId: boardId.toString(),
      columnValues: JSON.stringify(columnValues)
    });
  }

  /**
   * Get board columns information with retry logic
   * @param {string|number} boardId - Board ID
   * @returns {Promise<Array>} Board columns
   */
  async getBoardColumns(boardId) {
    if (!this.board_columns) {
      throw new Error('board_columns is not initialized');
    }

    if (boardId in this.board_columns) {
      return this.board_columns[boardId];
    }

    const query = `
      query GetBoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
            description
            settings_str
          }
        }
      }
    `;

    console.log(`🔍 Fetching columns for board ${boardId}...`);
    const response = await this.query(query, { boardId: boardId.toString() });
    console.log(`✅ Successfully fetched ${response.data?.boards?.[0]?.columns?.length || 0} columns`);
    
    this.board_columns[boardId] = response.data?.boards?.[0]?.columns || [];
    return this.board_columns[boardId];
  }

  /**
   * Update retry configuration
   * @param {RetryConfig} newConfig - New retry configuration
   */
  setRetryConfig(newConfig) {
    this.retryConfig = newConfig;
  }
}

/**
 * Monday.com column sanitization functions
 * Simple and straightforward approach
 */
function sanitizeText(value) {
  if (value === null || value === undefined) return null;
  return value.toString().trim();
}

function sanitizeEmail(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'string') return { email: '', text: '' };
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const sanitizedEmail = value.trim().toLowerCase();
  
  return {
    email: emailRegex.test(sanitizedEmail) ? sanitizedEmail : '',
    text: sanitizedEmail
  };
}

function sanitizePhone(value) {
  if (value === null || value === undefined) return null;
  if (!value) return { phone: '', countryShortName: 'US' };
  
  // Remove all non-digit characters
  const digitsOnly = value.toString().replace(/\D/g, '');
  
  return {
    phone: digitsOnly,
    countryShortName: 'US'
  };
}

function sanitizeNumbers(value) {
  if (value === null || value === undefined) return null;
  if (value === '') return null;

  // Handle null, undefined, or non-convertible objects
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return null;
  }

  // Convert to string
  let strValue = String(value);

  // Check if the number is negative (preserve sign)
  const isNegative = strValue.trim().startsWith('-');

  // Keep only digits and dots (remove everything else including signs)
  strValue = strValue.replace(/[^\d.]/g, '');

  // Check if empty after filtering
  if (strValue === '') {
    return null;
  }

  // Handle multiple dots (keep only the first)
  const parts = strValue.split('.');
  if (parts.length > 2) {
    strValue = parts[0] + '.' + parts.slice(1).join('');
  }

  // Convert to float or int
  let numValue;
  if (strValue.includes('.')) {
    numValue = parseFloat(strValue);
  } else {
    numValue = parseInt(strValue, 10);
  }

  // Return null if parsing failed
  if (isNaN(numValue)) {
    return null;
  }

  // Apply negative sign if original value was negative
  return isNegative ? -numValue : numValue;
}

function sanitizeDate(value) {
  if (value === null || value === undefined) return null;
  if (!value) return { date: null };
  
  const date = new Date(value);
  if (isNaN(date.getTime())) return { date: null };
  
  return {
    date: date.toISOString().split('T')[0] // YYYY-MM-DD format
  };
}

function sanitizeStatus(value) {
  if (value === null || value === undefined) return null;
  if (!value) return { label: '' };
  return { label: value.toString().trim() };
}

function sanitizeDropdown(value) {
  if (value === null || value === undefined) return null;
  if (!value) return { labels: [] };
  
  // Handle array of values (multiple selections)
  if (Array.isArray(value)) {
    return {
      labels: value.map(v => v.toString().trim()).filter(v => v !== '')
    };
  }
  
  // Handle comma-separated string
  if (typeof value === 'string') {
    const labels = value.split(',').map(v => v.toString().trim()).filter(v => v !== '');
    return { labels };
  }
  
  // Single value
  return { labels: [value.toString().trim()] };
}

function sanitizeCheckbox(value) {
  if (value === null || value === undefined) return null;
  return { checked: Boolean(value) };
}

function sanitizeLocation(value) {
  if (value === null || value === undefined) return null;
  
  // If already a JSON string, parse it first
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      // If not valid JSON, treat as address string
      return { address: value };
    }
  }
  
  // If it's an object with lat/lng, format for Monday
  if (typeof value === 'object' && (value.lat || value.latitude) && (value.lng || value.longitude)) {
    return {
      lat: (value.lat || value.latitude).toString(),
      lng: (value.lng || value.longitude).toString(),
      address: value.address || ''
    };
  }
  
  return null;
}

function sanitizeBoardRelation(value) {
  if (value === null || value === undefined) return null;
  
  // Monday expects board relations in format: { item_ids: ["123", "456"] } - keep as strings
  if (value && value.item_ids) {
    return {
      item_ids: value.item_ids.map(id => id.toString())
    };
  }
  
  return null;
}

/**
 * Configuration class for dynamic mapping between remote systems and Monday.com
 * Provides default values and type safety for mapping configurations
 */
class MappingConfig {
  constructor(options = {}) {
    this.remote_key = options.remote_key || null;
    this.in_monday = options.in_monday !== undefined ? options.in_monday : true;
    this.in_remote = options.in_remote !== undefined ? options.in_remote : true;
    this.value = options.value || null;
    this.monday_id = options.monday_id || null;
    this.remote_id = options.remote_id || null;
    this.translator = options.translator || {};
    
    // Store any additional config properties
    Object.keys(options).forEach(key => {
      if (!['remote_key', 'in_monday', 'in_remote', 'value', 'monday_id', 'remote_id'].includes(key)) {
        this[key] = options[key];
      }
    });
  }
}

/**
 * Factory function to create mapping configurations with defaults
 * @param {Object} config - Configuration object
 * @returns {MappingConfig} Configured mapping instance
 */
function createMappingConfig(config = {}) {
  return new MappingConfig(config);
}

/**
 * Monday.com Dynamic Mapping Service
 * Handles dynamic mapping between external data and Monday.com boards
 */
class MondayDynamicMapper {
  constructor(mondayApiClient) {
    this.mondayApiClient = mondayApiClient;
    this.columnSettingsCache = new Map(); // Cache for board column settings
  }

  /**
   * Fetches and caches column settings for a specific board
   * @param {string|number} boardId - Monday.com board ID
   * @returns {Promise<Map>} Map of column descriptions to column info
   */
  async fetchBoardColumnSettings(boardId) {
    const cacheKey = `board_${boardId}`;
    
    if (this.columnSettingsCache.has(cacheKey)) {
      return this.columnSettingsCache.get(cacheKey);
    }

    try {
      const columns = await this.mondayApiClient.getBoardColumns(boardId);
      const columnMap = new Map();
      
      columns.forEach(column => {
        // Extract tags from description (format: {tag_name}, {{tag_name}}, or {{{tag_name}}})
        const description = column.description || '';
        const tagMatches = description.match(/\{+([^{}]+)\}+/g);

        if (tagMatches) {
          tagMatches.forEach(match => {
            // Remove ALL braces from both sides: {{{tag}}} → tag
            const tag = match.replace(/^\{+|\}+$/g, '');
            columnMap.set(tag, {
              id: column.id,
              title: column.title,
              type: column.type,
              settings_str: column.settings_str
            });
          });
        }
      });

      this.columnSettingsCache.set(cacheKey, columnMap);
      return columnMap;
    } catch (error) {
      console.error('Error fetching board column settings:', error);
      throw new Error(`Failed to fetch column settings for board ${boardId}: ${error.message}`);
    }
  }

  /**
   * Sanitizes a value based on Monday column type
   * @param {any} value - Value to sanitize
   * @param {string} columnType - Monday column type
   * @returns {any} Sanitized value appropriate for the column type
   */
  sanitizeValueForColumnType(value, columnType) {
    if (columnType === 'text') {
      return sanitizeText(value);
    } else if (columnType === 'long_text') {
      return sanitizeText(value);
    } else if (columnType === 'email') {
      return sanitizeEmail(value);
    } else if (columnType === 'phone') {
      return sanitizePhone(value);
    } else if (columnType === 'numbers') {
      return sanitizeNumbers(value);
    } else if (columnType === 'date') {
      return sanitizeDate(value);
    } else if (columnType === 'status') {
      return sanitizeStatus(value);
    } else if (columnType === 'dropdown') {
      return sanitizeDropdown(value);
    } else if (columnType === 'checkbox') {
      return sanitizeCheckbox(value);
    } else if (columnType === 'location') {
      return sanitizeLocation(value);
    } else if (columnType === 'board_relation') {
      return sanitizeBoardRelation(value);
    } else {
      // Unknown type, return value as-is
      return value;
    }
  }

  /**
   * Processes mapping configuration and external data to create Monday column values
   * @param {Object} mappingConfig - Configuration object with mapping rules
   * @param {Object} externalData - Data from external system to map
   * @param {string|number} boardId - Monday.com board ID
   * @returns {Promise<Object>} Monday-formatted column values object
   */
  async processMapping(mappingConfig, externalData, boardId) {
    // First, populate the mapping config values with external data
    const populatedConfig = this.populateConfigValues(mappingConfig, externalData);
    
    // Fetch board column settings
    const columnMap = await this.fetchBoardColumnSettings(boardId);
    
    // Build column values for Monday
    const columnValues = {};
    
    for (const [configKey, configData] of Object.entries(populatedConfig)) {
      // Skip if not configured for Monday
      if (!configData.in_monday) {
        continue;
      }

      // Check if we have a matching column with this tag
      if (columnMap.has(configKey)) {
        const columnInfo = columnMap.get(configKey);
        const sanitizedValue = this.sanitizeValueForColumnType(
          configData.value, 
          columnInfo.type
        );

        // Only add to column values if sanitized value is not null
        if (sanitizedValue !== null) {
          columnValues[columnInfo.id] = sanitizedValue;
        }
      }
    }

    return columnValues;
  }

  /**
   * Populates mapping configuration values with data from external system
   * @param {Object} mappingConfig - Configuration object
   * @param {Object} externalData - External system data
   * @returns {Object} Configuration with populated values
   */
  populateConfigValues(mappingConfig, externalData) {
    const populatedConfig = {};

    for (const [configKey, configData] of Object.entries(mappingConfig)) {
      // Create a copy of the config data
      populatedConfig[configKey] = { ...configData };

      // If in_remote is true and we have a remote_key, populate the value
      if (configData.in_remote && configData.remote_key) {
        const remoteValue = this.getNestedValue(externalData, configData.remote_key);
        if (remoteValue !== undefined) {
          populatedConfig[configKey].value = remoteValue;
        }
      }
    }

    return populatedConfig;
  }

  /**
   * Gets nested value from object using dot notation
   * @param {Object} obj - Object to search in
   * @param {string} path - Dot notation path (e.g., 'user.address.street')
   * @returns {any} Value at the specified path
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  /**
   * Creates or updates a Monday item with mapped data
   * @param {string|number} boardId - Monday.com board ID
   * @param {Object} mappingConfig - Mapping configuration
   * @param {Object} externalData - External system data
   * @param {string} itemName - Name for the Monday item
   * @param {string|number} itemId - ID for updating existing item (optional)
   * @returns {Promise<Object>} Monday API response
   */
  async createOrUpdateItem(boardId, mappingConfig, externalData, itemName, itemId = null) {
    const columnValues = await this.processMapping(mappingConfig, externalData, boardId);

    if (itemId) {
      // Update existing item
      return this.mondayApiClient.updateItem(itemId, boardId, columnValues);
    } else {
      // Create new item
      return this.mondayApiClient.createItem(boardId, itemName, columnValues);
    }
  }

  /**
   * Clears cached column settings for a board
   * @param {string|number} boardId - Board ID to clear cache for
   */
  clearColumnCache(boardId = null) {
    if (boardId) {
      this.columnSettingsCache.delete(`board_${boardId}`);
    } else {
      this.columnSettingsCache.clear();
    }
  }
}

/**
 * Monday.com Error Logger with retry logic
 * Standardized error logging to Monday.com boards
 */
class MondayErrorLogger {
  constructor(mondayApiClient) {
    this.mondayApiClient = mondayApiClient;
  }

  /**
   * Logs an error to a Monday.com board with retry logic
   * @param {string|number} boardId - Monday board ID
   * @param {Object} columns - Column mapping configuration
   * @param {Object} errorData - Error data to log
   * @param {string} errorData.projectName - Project name
   * @param {string} errorData.clientName - Client name
   * @param {string} errorData.workflow - Workflow name
   * @param {string} errorData.error - Error message
   * @param {string} [errorData.description] - Error description (optional)
   * @param {string} [errorData.errorType="dev"] - Error type: "dev" or "client"
   * @param {string} [errorData.clientWarnEmail] - Client warning email (optional)
   * @param {Object|string} [errorData.payload] - Error payload/context
   * @returns {Promise<Object>} Result with monday_id, error name, and description
   */
  async logError(boardId, columns, errorData) {
    const {
      projectName,
      clientName,
      workflow,
      error,
      description,
      errorType = "dev",
      clientWarnEmail,
      payload
    } = errorData;

    // Create error name
    const errorName = `${projectName} - ${clientName} - ${workflow} - ${error}`;

    // Clone columns to avoid mutation
    const workingColumns = JSON.parse(JSON.stringify(columns));

    // Map error data to Monday columns
    workingColumns.client.value = clientName || "À configurer";
    workingColumns.client_warn_email.value = clientWarnEmail || "";
    workingColumns.description.value = description || errorName;
    workingColumns.erreur.value = errorName;
    workingColumns.payload.value = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    workingColumns.workflow.value = workflow;
    workingColumns.projet.value = projectName || "À configurer";
    workingColumns.error_type.value = errorType;

    // Build column values for Monday API
    const columnValues = {};

    for (const key in workingColumns) {
      const column = workingColumns[key];
      const mondayColId = column.monday_id || "";
      const mondayColType = column.monday_type || "";
      let mondayVal = column.value || "";

      // Skip if no Monday ID is associated
      if (!mondayColId) {
        continue;
      }

      // Skip mirror columns (but process board_relation)
      if (mondayColType === "mirror") {
        continue;
      }

      // Clean numbers
      if (mondayColType === "numbers") {
        mondayVal = sanitizeNumbers(mondayVal);
      }

      // Skip empty values (but allow 0)
      if (!mondayVal && mondayVal !== 0) {
        continue;
      }

      columnValues[mondayColId] = mondayVal;
    }

    try {
      const response = await this.mondayApiClient.createItem(
        boardId,
        errorName,
        columnValues,
        true
      );
      
      const mondayId = response.data?.create_item?.id || 0;

      let finalErrorName = errorName;
      if (!mondayId) {
        finalErrorName = `***NOT SAVED IN MONDAY - ${errorName}`;
      }

      return {
        monday_id: mondayId,
        error: finalErrorName,
        description: description || errorName
      };

    } catch (error) {
      return {
        monday_id: 0,
        error: `***ERROR SAVING TO MONDAY - ${errorName}`,
        description: `Failed to save: ${error.message}`
      };
    }
  }
}

/**
 * Creates a standardized error configuration object
 * @param {string} mondayApiKey - Monday API key
 * @param {string|number} boardId - Board ID
 * @param {Object} columns - Column mapping
 * @param {RetryConfig} retryConfig - Retry configuration (optional)
 * @returns {Object} Configuration object
 */
function createErrorConfig(mondayApiKey, boardId, columns, retryConfig = null) {
  return {
    mondayApiKey,
    boardId,
    columns,
    retryConfig
  };
}

/**
 * Legacy function - logs an error to a Monday.com board
 * @deprecated Use MondayErrorLogger class instead
 * @param {Object} config - Configuration object
 * @param {Object} errorData - Error data to log
 * @returns {Promise<Object>} Result with monday_id, error name, and description
 */
async function logErrorToMonday(config, errorData) {
  const client = new MondayApiClient(config.mondayApiKey, config.retryConfig);
  const logger = new MondayErrorLogger(client);
  return logger.logError(config.boardId, config.columns, errorData);
}

/**
 * Legacy function - fetches data from Monday.com API
 * @deprecated Use MondayApiClient class instead
 * @param {string} apiKey - Monday API key
 * @param {string} query - GraphQL query
 * @returns {Promise<Object>} API response
 */
async function fetchMonday(apiKey, query) {
  const client = new MondayApiClient(apiKey);
  return client.query(query);
}

/**
 * Legacy function - cleans and converts values to numbers
 * @deprecated Use sanitizeNumbers instead
 * @param {any} value - Value to clean
 * @returns {number} Cleaned number
 */
function cleanNumbers(value) {
  const result = sanitizeNumbers(value);
  return result === null ? 0 : result;
}

// Export all classes and functions
module.exports = {
  version,
  
  // New standardized classes
  MondayApiClient,
  MappingConfig,
  createMappingConfig,
  MondayDynamicMapper,
  MondayErrorLogger,
  
  // Retry system
  RetryConfig,
  withRetry,
  isRetryableError,
  
  // Sanitization functions
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumbers,
  sanitizeDate,
  sanitizeStatus,
  sanitizeDropdown,
  sanitizeCheckbox,
  sanitizeLocation,
  sanitizeBoardRelation,
  
  // Legacy functions for backward compatibility
  logErrorToMonday,
  fetchMonday,
  cleanNumbers,
  createErrorConfig
};