/**
 * @import-af/qbo-monday
 * Synchronization utilities between QuickBooks Online and Monday.com
 */

const version = '1.0.6';

/**
 * Organises QBO invoice data according to Monday.com mapping configuration
 * @param {Object} qboSettings - Configuration object with Monday column mappings
 * @param {Object} qboInvoice - QBO invoice object from API
 * @returns {Object} Updated qboSettings with mapped values
 */
function organiseQboInvoice(qboSettings, qboInvoice) {
  console.log(`version: ${version}`);

  // Deep clone settings to avoid mutation
  const settings = JSON.parse(JSON.stringify(qboSettings));
  
  // Extract values from QBO invoice
  const invoiceId = qboInvoice.Id || "";
  const docNumber = qboInvoice.DocNumber || "";
  const txnDate = qboInvoice.TxnDate || "";
  const dueDate = qboInvoice.DueDate || "";
  const customerId = qboInvoice.CustomerRef?.value || "";
  const customerName = qboInvoice.CustomerRef?.name || "";
  const totalAmount = qboInvoice.TotalAmt || 0;
  const balance = qboInvoice.Balance || 0;
  
  // Calculate subtotal (total minus taxes)
  const totalTax = qboInvoice.TxnTaxDetail?.TotalTax || 0;
  const subTotal = totalAmount - totalTax;
  
  // Map values to Monday columns
  if (settings.recevales_columns) {
    // Basic invoice data
    settings.recevales_columns.bill_id.value = invoiceId;
    settings.recevales_columns.bill_number.value = docNumber;
    settings.recevales_columns.date.value = txnDate;
    settings.recevales_columns.date_due.value = dueDate;
    
    // Customer information
    settings.recevales_columns.qbo_customer_id.value = customerId;
    settings.recevales_columns.organisation_text.value = customerName;
    
    // Financial amounts
    settings.recevales_columns.sub_total.value = subTotal;
    settings.recevales_columns.total.value = totalAmount;
    settings.recevales_columns.balance.value = balance;
    
    // Default empty values (keeping original empty state)
    settings.recevales_columns.organisation.value = "";
    settings.recevales_columns.provenance.value = "";
    
    // Status - force default value to done (action completed)
    settings.recevales_columns.status.value = settings.status_recevales_labels?.fetched || "Fetched";

    // Avoid setting status by default (import)
    // settings.recevales_columns.status.monday_id = "";

    // Determine balance status with default fallback
    let balanceStatus = settings.status_balance_labels?.to_pay || "To Pay";
    
    if (balance <= 0) {
      balanceStatus = settings.status_balance_labels?.paid || "Paid";
    } else if (balance > 0 && balance < totalAmount) {
      balanceStatus = settings.status_balance_labels?.partial || "Partial";
    }
    
    settings.recevales_columns.status_balance.value = balanceStatus;
    
    // Extract terms information if available (only if exists in QBO)
    if (qboInvoice.SalesTermRef?.value) {
      const qboTermId = qboInvoice.SalesTermRef.value; // This is already the ID (e.g., "4")
      
      if (settings.recevales_columns.terme_id) {
        settings.recevales_columns.terme_id.value = qboTermId;
      }
    }
    
    // Set type with default value
    if (settings.recevales_columns.type) {
      settings.recevales_columns.type.value = "Recevable";
    }
  }
  
  return settings;
}

/**
 * Extracts customer email from QBO invoice if available
 * @param {Object} qboInvoice - QBO invoice object
 * @returns {string} Customer email or empty string
 */
function extractCustomerEmail(qboInvoice) {
  // QBO invoices don't always include email in the invoice object
  // This would typically come from a separate customer query
  return qboInvoice.CustomerRef?.email || "";
}

/**
 * Validates that required fields are present in the invoice
 * @param {Object} qboInvoice - QBO invoice object
 * @returns {Object} Validation result with isValid flag and missing fields
 */
function validateQboInvoice(qboInvoice) {
  const requiredFields = ['Id', 'DocNumber', 'TxnDate', 'CustomerRef', 'TotalAmt'];
  const missingFields = [];
  
  requiredFields.forEach(field => {
    if (field === 'CustomerRef') {
      if (!qboInvoice.CustomerRef?.value) {
        missingFields.push('CustomerRef.value');
      }
    } else if (!qboInvoice[field]) {
      missingFields.push(field);
    }
  });
  
  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}

/**
 * Gets formatted date for Monday.com (YYYY-MM-DD format)
 * @param {string} qboDate - Date from QBO (YYYY-MM-DD format)
 * @returns {string} Formatted date for Monday
 */
function formatDateForMonday(qboDate) {
  if (!qboDate) return "";
  
  // QBO dates are already in YYYY-MM-DD format, but let's ensure consistency
  const date = new Date(qboDate);
  if (isNaN(date.getTime())) return qboDate; // Return original if invalid
  
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Export all functions
module.exports = {
  version,
  organiseQboInvoice,
  extractCustomerEmail,
  validateQboInvoice,
  formatDateForMonday
};