// ════════════════════════════════════════════════════════════════════════════
// SRI SAI SPECIALITY DENTAL CARE — COMPLETE GOOGLE APPS SCRIPT
// v2 (speed): cached getAllData, write lock, duplicate-safe bills/purchases,
//             correct stock when the same medicine is billed twice.
// After pasting: Deploy → Manage deployments → Edit (pencil) → Version: New
//                version → Deploy. (Keeps the SAME /exec link.)
// ════════════════════════════════════════════════════════════════════════════

var SS_ID = "1rOwubjghrsuWiGXR8X1A1841_8yd-cmMQIj44QBqNaA";

function getCurrentDateTime() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch(e) {}
  return '';
}

function formatTime(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'string' && /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(value.trim())) {
    return value.trim().toUpperCase();
  }
  var h, m;
  if (typeof value === 'number' && value >= 0 && value < 1) {
    var totalMins = Math.round(value * 24 * 60);
    h = Math.floor(totalMins / 60);
    m = totalMins % 60;
  } else if (value instanceof Date) {
    h = value.getHours(); m = value.getMinutes();
  } else if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    var parts = value.split(':'); h = parseInt(parts[0]); m = parseInt(parts[1]);
  }
  if (h === undefined) return String(value);
  var snapM = m < 15 ? 0 : m < 45 ? 30 : 0;
  var snapH = m >= 45 ? h + 1 : h;
  if (snapH >= 24) snapH = 23;
  var ampm = snapH < 12 ? 'AM' : 'PM';
  var h12  = snapH % 12 || 12;
  return ('0' + h12).slice(-2) + ':' + (snapM === 0 ? '00' : '30') + ' ' + ampm;
}

function sendJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function styleHeaderRow(sheet, numCols) {
  var range = sheet.getRange(1, 1, 1, numCols);
  range.setBackground('#1e3f5a');
  range.setFontColor('#ffffff');
  range.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    styleHeaderRow(sheet, headers.length);
  }
  return sheet;
}

function findRowById(sheet, id, col) {
  col = col || 1;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col - 1]) === String(id)) return i + 1;
  }
  return -1;
}

// ════════════════════════════════════════════════════════════════════════════
// SPEED: getAllData is cached (CacheService). Any save/delete bumps DATA_VER,
// so every device gets fresh data right after a change. Writes are queued
// one-at-a-time with a lock so two phones saving together can't clash.
// ════════════════════════════════════════════════════════════════════════════
var READ_ACTIONS = { getAllData: 1, getSettings: 1, getExpenses: 1 };
var CACHE_TTL_SECONDS = 600;   // safety net for edits typed directly into the Sheet
var CACHE_CHUNK = 30000;       // characters per cache entry (CacheService limit is 100KB)

function getDataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VER') || '0';
}
function bumpDataVersion_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VER', String(Date.now()));
}
// Run this once from the editor (or it runs by itself on manual sheet edits
// if the script is bound to the spreadsheet) to force fresh data.
function clearDataCache() { bumpDataVersion_(); }
function onEdit(e) { try { bumpDataVersion_(); } catch (err) {} }

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getAllData';
  if (READ_ACTIONS[action]) return route_(action, e);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return sendJSON({ success: false, error: 'Server busy, please retry' });
  }
  try {
    var out = route_(action, e);
    bumpDataVersion_();
    return out;
  } finally {
    lock.releaseLock();
  }
}

function route_(action, e) {
  try {
    if (action === 'getAllData')               return getAllData();
    if (action === 'saveBill')                return saveBill(e.parameter);
    if (action === 'deleteBill')              return deleteBill(e.parameter);
    if (action === 'addMedicine')             return addMedicine(e.parameter);
    if (action === 'updateMedicine')          return updateMedicine(e.parameter);
    if (action === 'deleteMedicine')          return deleteMedicine(e.parameter);
    if (action === 'addPurchase')             return addPurchase(e.parameter);
    if (action === 'deletePurchase')          return deletePurchase(e.parameter);
    if (action === 'saveTreatmentReceipt')    return saveTreatmentReceipt(e.parameter);
    if (action === 'deleteTreatmentReceipt')  return deleteTreatmentReceipt(e.parameter);
    if (action === 'savePrescription')        return savePrescription(e.parameter);
    if (action === 'deletePrescription')      return deletePrescription(e.parameter);
    if (action === 'savePatient')             return savePatient(e.parameter);
    if (action === 'deletePatient')           return deletePatient(e.parameter);
    if (action === 'saveAppointment')         return saveAppointment(e.parameter);
    if (action === 'updateAppointmentStatus') return updateAppointmentStatus(e.parameter);
    if (action === 'deleteAppointment')       return deleteAppointment(e.parameter);
    if (action === 'saveExamForm')            return saveExamForm(e.parameter);
    if (action === 'deleteExamForm')          return deleteExamForm(e.parameter);
    if (action === 'saveSettings')            return saveSettings(e.parameter);
    if (action === 'getSettings')             return getSettings(e.parameter);
    if (action === 'saveExpense')             return saveExpense(e.parameter);
    if (action === 'deleteExpense')           return deleteExpense(e.parameter);
    if (action === 'getExpenses')             return getExpenses();
    return sendJSON({ error: 'Unknown action: ' + action });
  } catch(err) {
    return sendJSON({ error: err.toString() });
  }
}

function doPost(e) { return doGet(e); }

// ════════════════════════════════════════════════════════════════════════════
// GET ALL DATA
// ════════════════════════════════════════════════════════════════════════════
function getAllData() {
  var cache = CacheService.getScriptCache();
  var ver = getDataVersion_();
  var prefix = 'AD_' + ver + '_';
  // ── 1. Try cache (typically ~100–300 ms instead of several seconds)
  try {
    var n = parseInt(cache.get(prefix + 'n'), 10);
    if (n > 0) {
      var keys = [];
      for (var k = 0; k < n; k++) keys.push(prefix + k);
      var got = cache.getAll(keys);
      var parts = [];
      for (var k2 = 0; k2 < n; k2++) { if (got[keys[k2]] == null) { parts = null; break; } parts.push(got[keys[k2]]); }
      if (parts) {
        return ContentService.createTextOutput(parts.join('')).setMimeType(ContentService.MimeType.JSON);
      }
    }
  } catch (cacheErr) {}

  // ── 2. Cache miss: read the sheets
  var result = buildAllData_();
  var json = JSON.stringify(result);
  if (result.success && getDataVersion_() === ver) {   // don't cache if a save happened meanwhile
    try {
      var entries = {}, count = 0;
      for (var p = 0; p < json.length; p += CACHE_CHUNK) entries[prefix + (count++)] = json.substring(p, p + CACHE_CHUNK);
      entries[prefix + 'n'] = String(count);
      cache.putAll(entries, CACHE_TTL_SECONDS);
    } catch (putErr) {}
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function buildAllData_() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);

    var medicines = [];
    var medicinesSheet = ss.getSheetByName('Medicines');
    if (medicinesSheet && medicinesSheet.getLastRow() > 1) {
      var mData = medicinesSheet.getDataRange().getValues();
      for (var i = 1; i < mData.length; i++) {
        if (!mData[i][0]) continue;
        medicines.push({
          id: mData[i][0], name: mData[i][1],
          stock: parseInt(mData[i][2]) || 0,
          price: parseFloat(mData[i][3]) || 0,
          costPrice: parseFloat(mData[i][4]) || 0,
          expiry: formatDate(mData[i][5])
        });
      }
    }

    var allBillItems = {};
    var billItemsSheet = ss.getSheetByName('BillItems');
    if (billItemsSheet && billItemsSheet.getLastRow() > 1) {
      var iData = billItemsSheet.getDataRange().getValues();
      for (var j = 1; j < iData.length; j++) {
        if (!iData[j][0]) continue;
        var bId = String(iData[j][0]);
        if (!allBillItems[bId]) allBillItems[bId] = [];
        allBillItems[bId].push({
          medicineId: iData[j][1], medicineName: iData[j][2],
          qty: parseInt(iData[j][3]) || 0, price: parseFloat(iData[j][4]) || 0,
          costPrice: parseFloat(iData[j][5]) || 0, amount: parseFloat(iData[j][6]) || 0
        });
      }
    }

    var bills = [];
    var billsSheet = ss.getSheetByName('Bills');
    if (billsSheet && billsSheet.getLastRow() > 1) {
      var bData = billsSheet.getDataRange().getValues();
      var headerJ = String(bData[0] && bData[0][9] ? bData[0][9] : '').toLowerCase();
      var hasPaymentModeCol = headerJ.indexOf('payment') !== -1 || headerJ.indexOf('pay') !== -1;
      for (var i = 1; i < bData.length; i++) {
        if (!bData[i][0]) continue;
        var bId = String(bData[i][0]);
        var payMode = 'Cash';
        if (hasPaymentModeCol) {
          var pm = String(bData[i][9] || '').trim();
          var validModes = ['cash','upi','card','cheque','online','neft','rtgs'];
          payMode = validModes.indexOf(pm.toLowerCase()) !== -1 ?
                    pm.charAt(0).toUpperCase() + pm.slice(1).toLowerCase() : 'Cash';
        }
        bills.push({
          billId: bId, patientName: bData[i][1], doctor: bData[i][2],
          phone: bData[i][3], date: formatDate(bData[i][4]),
          subtotal: parseFloat(bData[i][5]) || 0, discount: parseFloat(bData[i][6]) || 0,
          total: parseFloat(bData[i][7]) || 0, costTotal: parseFloat(bData[i][8]) || 0,
          paymentMode: payMode,
          items: allBillItems[bId] || []
        });
      }
    }

    var purchases = [];
    var purchasesSheet = ss.getSheetByName('Purchases');
    if (purchasesSheet && purchasesSheet.getLastRow() > 1) {
      var pData = purchasesSheet.getDataRange().getValues();
      for (var i = 1; i < pData.length; i++) {
        if (!pData[i][0]) continue;
        purchases.push({
          id: String(pData[i][0]), date: formatDate(pData[i][1]),
          supplier: pData[i][2], medicineId: pData[i][3], medicineName: pData[i][4],
          qty: parseInt(pData[i][5]) || 0, costPrice: parseFloat(pData[i][6]) || 0,
          totalCost: parseFloat(pData[i][7]) || 0
        });
      }
    }

    var patients = [];
    var ptSheet = ss.getSheetByName('Patients');
    if (ptSheet && ptSheet.getLastRow() > 1) {
      var ptData = ptSheet.getDataRange().getValues();
      for (var i = 1; i < ptData.length; i++) {
        if (!ptData[i][0]) continue;
        patients.push({
          id: ptData[i][0], name: ptData[i][1], phone: ptData[i][2],
          age: ptData[i][3], sex: ptData[i][4], doctor: ptData[i][5],
          treatment: ptData[i][6], balance: parseFloat(ptData[i][7]) || 0,
          alerts: ptData[i][8], status: ptData[i][9],
          lastVisit: formatDate(ptData[i][10]), addedOn: formatDate(ptData[i][11])
        });
      }
    }

    var appointments = [];
    var apptSheet = ss.getSheetByName('Appointments');
    if (apptSheet && apptSheet.getLastRow() > 1) {
      var apptData = apptSheet.getDataRange().getValues();
      for (var i = 1; i < apptData.length; i++) {
        if (!apptData[i][0]) continue;
        appointments.push({
          id: apptData[i][0], patient: apptData[i][1], phone: apptData[i][2],
          date: formatDate(apptData[i][3]), time: formatTime(apptData[i][4]),
          reason: apptData[i][5], doctor: apptData[i][6],
          status: apptData[i][7], bookedAt: apptData[i][8]
        });
      }
    }

    var treatmentReceipts = [];
    var trSheet = ss.getSheetByName('TreatmentReceipts');
    if (trSheet && trSheet.getLastRow() > 1) {
      var trData = trSheet.getDataRange().getValues();
      for (var i = 1; i < trData.length; i++) {
        if (!trData[i][0]) continue;
        treatmentReceipts.push({
          no:          String(trData[i][0]),
          date:        formatDate(trData[i][1]),
          patient:     String(trData[i][2] || ''),
          doctor:      String(trData[i][3] || ''),
          amount:      parseFloat(trData[i][4]) || 0,
          amountWords: String(trData[i][5] || ''),
          treatments:  String(trData[i][6] || ''),
          savedAt:     String(trData[i][7] || '')
        });
      }
    }

    // ── EXPENSES ─────────────────────────────────────────────────────────
    var expenses = [];
    var expensesSheet = ss.getSheetByName('Expenses');
    if (expensesSheet && expensesSheet.getLastRow() > 1) {
      var expData = expensesSheet.getDataRange().getValues();
      for (var i = 1; i < expData.length; i++) {
        if (!expData[i][0]) continue;
        expenses.push({
          id:       String(expData[i][0]),
          date:     formatDate(expData[i][1]),
          category: String(expData[i][2] || ''),
          amount:   parseFloat(expData[i][3]) || 0,
          vendor:   String(expData[i][4] || ''),
          notes:    String(expData[i][5] || ''),
          mode:     String(expData[i][6] || 'Cash'),
          addedAt:  String(expData[i][7] || '')
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    return {
      success: true,
      medicines: medicines,
      bills: bills,
      purchases: purchases,
      patients: patients,
      appointments: appointments,
      treatmentReceipts: treatmentReceipts,
      expenses: expenses
    };
  } catch(err) {
    return { success: false, error: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GET EXPENSES ONLY (dedicated endpoint)
// ════════════════════════════════════════════════════════════════════════════
function getExpenses() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var expenses = [];
    var expensesSheet = ss.getSheetByName('Expenses');
    if (expensesSheet && expensesSheet.getLastRow() > 1) {
      var expData = expensesSheet.getDataRange().getValues();
      for (var i = 1; i < expData.length; i++) {
        if (!expData[i][0]) continue;
        expenses.push({
          id:       String(expData[i][0]),
          date:     formatDate(expData[i][1]),
          category: String(expData[i][2] || ''),
          amount:   parseFloat(expData[i][3]) || 0,
          vendor:   String(expData[i][4] || ''),
          notes:    String(expData[i][5] || ''),
          mode:     String(expData[i][6] || 'Cash'),
          addedAt:  String(expData[i][7] || '')
        });
      }
    }
    return sendJSON({ success: true, expenses: expenses });
  } catch(err) {
    return sendJSON({ success: false, error: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BILLS
// ════════════════════════════════════════════════════════════════════════════
function saveBill(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var billsSheet = ss.getSheetByName('Bills');
    var billItemsSheet = ss.getSheetByName('BillItems');
    var medicinesSheet = ss.getSheetByName('Medicines');
    if (!billsSheet || !billItemsSheet) return sendJSON({ success: false, error: 'Bills sheets not found' });
    var billId = params.billId;
    var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var dateTime = getCurrentDateTime();
    var items = [];
    try { items = JSON.parse(params.items); } catch(e) {}
    // Duplicate protection: if this bill was already saved (e.g. a retry after
    // a network drop), don't add it again.
    var lastBillRow = billsSheet.getLastRow();
    if (billId && lastBillRow > 1) {
      var ids = billsSheet.getRange(2, 1, lastBillRow - 1, 1).getValues();
      for (var d = ids.length - 1; d >= 0; d--) {
        if (String(ids[d][0]) === String(billId)) return sendJSON({ success: true, billId: billId, duplicate: true });
      }
    }
    billsSheet.appendRow([
      billId, params.patientName||'', params.doctor||'', params.phone||'',
      date, parseFloat(params.subtotal)||0, parseFloat(params.discount)||0,
      parseFloat(params.total)||0, parseFloat(params.costTotal)||0,
      params.paymentMode||'Cash', dateTime
    ]);
    if (items.length > 0) {
      var itemRows = items.map(function(item) {
        return [billId, item.medicineId||'', item.medicineName||item.name||'',
          parseInt(item.qty)||0, parseFloat(item.price)||0, parseFloat(item.costPrice)||0,
          parseFloat(item.amount)||0, dateTime];
      });
      billItemsSheet.getRange(billItemsSheet.getLastRow()+1, 1, itemRows.length, 8).setValues(itemRows);
      if (medicinesSheet && medicinesSheet.getLastRow() > 1) {
        var stockMap = {};
        items.forEach(function(item) {
          if (item.medicineId) {
            var key = String(item.medicineId);
            stockMap[key] = (stockMap[key] || 0) + (parseInt(item.qty) || 0);   // same medicine twice → add up
          }
        });
        var nMed = medicinesSheet.getLastRow() - 1;
        var idCol = medicinesSheet.getRange(2, 1, nMed, 1).getValues();
        var stockRange = medicinesSheet.getRange(2, 3, nMed, 1);
        var stockCol = stockRange.getValues();
        var changed = false;
        for (var i = 0; i < nMed; i++) {
          var mid = String(idCol[i][0]);
          if (stockMap[mid] !== undefined) {
            stockCol[i][0] = Math.max(0, (parseInt(stockCol[i][0]) || 0) - stockMap[mid]);
            changed = true;
          }
        }
        if (changed) stockRange.setValues(stockCol);   // one write instead of one per medicine
      }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true, billId: billId });
  } catch(err) {
    return sendJSON({ success: false, error: err.toString() });
  }
}

function deleteBill(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var billsSheet = ss.getSheetByName('Bills');
    var billItemsSheet = ss.getSheetByName('BillItems');
    if (billsSheet) {
      var bData = billsSheet.getDataRange().getValues();
      for (var i = bData.length-1; i >= 1; i--) {
        if (String(bData[i][0]) === String(params.billId)) { billsSheet.deleteRow(i+1); break; }
      }
    }
    if (billItemsSheet && billItemsSheet.getLastRow() > 1) {
      var iData = billItemsSheet.getDataRange().getValues();
      for (var i = iData.length-1; i >= 1; i--) {
        if (String(iData[i][0]) === String(params.billId)) billItemsSheet.deleteRow(i+1);
      }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// MEDICINES
// ════════════════════════════════════════════════════════════════════════════
function addMedicine(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Medicines');
    if (!sheet) return sendJSON({ success: false, error: 'Medicines sheet not found' });
    var id = Date.now();
    sheet.appendRow([id, params.name||'', parseInt(params.stock)||0, parseFloat(params.price)||0,
      parseFloat(params.costPrice)||0, params.expiry||'', getCurrentDateTime()]);
    SpreadsheetApp.flush();
    return sendJSON({ success: true, medicineId: id });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function updateMedicine(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Medicines');
    if (!sheet) return sendJSON({ success: false, error: 'Sheet not found' });
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(params.id)) {
        if (params.name)      sheet.getRange(i+1,2).setValue(params.name);
        if (params.stock)     sheet.getRange(i+1,3).setValue(parseInt(params.stock));
        if (params.price)     sheet.getRange(i+1,4).setValue(parseFloat(params.price));
        if (params.costPrice) sheet.getRange(i+1,5).setValue(parseFloat(params.costPrice));
        if (params.expiry)    sheet.getRange(i+1,6).setValue(params.expiry);
        sheet.getRange(i+1,7).setValue(getCurrentDateTime());
        break;
      }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deleteMedicine(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Medicines');
    if (!sheet) return sendJSON({ success: false, error: 'Sheet not found' });
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (String(data[i][0]) === String(params.id)) { sheet.deleteRow(i+1); break; }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// PURCHASES
// ════════════════════════════════════════════════════════════════════════════
function addPurchase(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Purchases');
    var medSheet = ss.getSheetByName('Medicines');
    if (!sheet) return sendJSON({ success: false, error: 'Purchases sheet not found' });
    var qty = parseInt(params.qty)||0, cost = parseFloat(params.costPrice)||0;
    var purchaseId = params.id || ('PUR-' + Date.now());
    if (params.id && findRowById(sheet, params.id) > 0) return sendJSON({ success: true, duplicate: true });
    sheet.appendRow([purchaseId,
      params.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      params.supplier||'', params.medicineId||'', params.medicineName||'',
      qty, cost, qty*cost, getCurrentDateTime()]);
    if (medSheet && params.medicineId) {
      var data = medSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(params.medicineId)) {
          medSheet.getRange(i+1, 3).setValue((parseInt(data[i][2])||0) + qty); break;
        }
      }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deletePurchase(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Purchases');
    if (!sheet) return sendJSON({ success: true });
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (String(data[i][0]) === String(params.id)) { sheet.deleteRow(i+1); break; }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// TREATMENT RECEIPTS
// ════════════════════════════════════════════════════════════════════════════
function saveTreatmentReceipt(params) {
  try {
    var sheet = getOrCreateSheet('TreatmentReceipts',
      ['Receipt No','Date','Patient','Doctor','Amount','Amount in Words','Treatments','Saved At']);
    sheet.appendRow([params.receiptNo||'', params.date||'', params.patient||'', params.doctor||'',
      parseFloat(params.amount)||0, params.amountWords||'', params.treatments||'', getCurrentDateTime()]);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deleteTreatmentReceipt(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('TreatmentReceipts');
    if (!sheet) return sendJSON({ success: true });
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (String(data[i][0]) === String(params.no)) { sheet.deleteRow(i+1); break; }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// PRESCRIPTIONS
// ════════════════════════════════════════════════════════════════════════════
function savePrescription(params) {
  try {
    var sheet = getOrCreateSheet('Prescriptions',['Date','Patient Name','Age','Sex','Prescription','Saved At']);
    sheet.appendRow([params.date||'', params.patientName||'', params.age||'', params.sex||'',
      params.prescription||params.rxText||'', getCurrentDateTime()]);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deletePrescription(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Prescriptions');
    if (!sheet) return sendJSON({ success: true });
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (String(data[i][1]||'') === String(params.patientName||'')) { sheet.deleteRow(i+1); break; }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// PATIENTS
// ════════════════════════════════════════════════════════════════════════════
function savePatient(params) {
  try {
    var sheet = getOrCreateSheet('Patients',
      ['ID','Name','Phone','Age','Sex','Doctor','Treatment','Balance','Medical Alerts','Status','Last Visit','Added On']);
    var row = [params.id||'', params.name||'', params.phone||'', params.age||'', params.sex||'',
      params.doctor||'', params.treatment||'', parseFloat(params.balance)||0,
      params.alerts||'', params.status||'Active', params.lastVisit||'', params.addedOn||''];
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) { sheet.getRange(rowIdx,1,1,row.length).setValues([row]); }
    else { sheet.appendRow(row); }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deletePatient(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Patients');
    if (!sheet) return sendJSON({ success: true });
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) sheet.deleteRow(rowIdx);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// APPOINTMENTS
// ════════════════════════════════════════════════════════════════════════════
function saveAppointment(params) {
  try {
    var sheet = getOrCreateSheet('Appointments',
      ['ID','Patient','Phone','Date','Time','Reason','Doctor','Status','Booked At']);
    var row = [params.id||'', params.patient||'', params.phone||'',
      params.date||'', params.time||'', params.reason||'', params.doctor||'',
      params.status||'Confirmed', params.bookedAt||getCurrentDateTime()];
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) {
      sheet.getRange(rowIdx,1,1,row.length).setValues([row]);
      sheet.getRange(rowIdx,5).setNumberFormat('@STRING@');
    } else {
      sheet.appendRow(row);
      sheet.getRange(sheet.getLastRow(),5).setNumberFormat('@STRING@');
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function updateAppointmentStatus(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Appointments');
    if (!sheet) return sendJSON({ success: true });
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) sheet.getRange(rowIdx,8).setValue(params.status);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deleteAppointment(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Appointments');
    if (!sheet) return sendJSON({ success: true });
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) sheet.deleteRow(rowIdx);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// EXAM FORMS
// ════════════════════════════════════════════════════════════════════════════
function saveExamForm(params) {
  try {
    var sheet = getOrCreateSheet('ExamForms', [
      'Date','Patient','Age','Sex','Doctor','Phone','Swelling','TMJ','Lymph Nodes',
      'Oral Hygiene','Gingiva','Dental Caries','Missing Teeth','Stains','Calculus',
      'Provisional Diagnosis','Final Diagnosis','Treatment Plan','Treatment Notes',
      'Upper Arch','Lower Arch','Saved At']);
    sheet.appendRow([params.date||'', params.patient||'', params.age||'', params.sex||'',
      params.doctor||'', params.phone||'', params.swelling||'', params.tmj||'', params.lymph||'',
      params.oral_hygiene||'', params.gingiva||'', params.caries||'', params.missing_teeth||'',
      params.stains||'', params.calculus||'', params.prov_diag||'', params.final_diag||'',
      params.treatments||'', params.tp_notes||'', params.upper_teeth||'', params.lower_teeth||'',
      getCurrentDateTime()]);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deleteExamForm(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('ExamForms');
    if (!sheet) return sendJSON({ success: true });
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (String(data[i][1]||'') === String(params.patientName||'')) { sheet.deleteRow(i+1); break; }
    }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════════════
function saveExpense(params) {
  try {
    var sheet = getOrCreateSheet('Expenses',
      ['ID','Date','Category','Amount','Vendor','Notes','Payment Mode','Added At']);
    var row = [params.id||'', params.date||'', params.category||'',
      parseFloat(params.amount)||0, params.vendor||'', params.notes||'',
      params.mode||'Cash', getCurrentDateTime()];
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) { sheet.getRange(rowIdx,1,1,row.length).setValues([row]); }
    else { sheet.appendRow(row); }
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function deleteExpense(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Expenses');
    if (!sheet) return sendJSON({ success: true });
    var rowIdx = findRowById(sheet, params.id);
    if (rowIdx > 0) sheet.deleteRow(rowIdx);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════
function saveSettings(params) {
  try {
    var sheet = getOrCreateSheet('Settings', ['Key','Value','Updated At']);
    var key = params.settingKey||'', value = params.settingValue||'';
    if (!key) return sendJSON({ success: false, error: 'No key' });
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        sheet.getRange(i+1,2).setValue(value);
        sheet.getRange(i+1,3).setValue(getCurrentDateTime());
        SpreadsheetApp.flush();
        return sendJSON({ success: true });
      }
    }
    sheet.appendRow([key, value, getCurrentDateTime()]);
    SpreadsheetApp.flush();
    return sendJSON({ success: true });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

function getSettings(params) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Settings');
    if (!sheet) return sendJSON({ success: false, value: null });
    var key = params.settingKey||'';
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === key) return sendJSON({ success: true, value: String(data[i][1]||'') });
    }
    return sendJSON({ success: false, value: null });
  } catch(err) { return sendJSON({ success: false, error: err.toString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP ALL SHEETS
// ════════════════════════════════════════════════════════════════════════════
function setupSheets() {
  getOrCreateSheet('Medicines',         ['ID','Name','Stock','Unit Price','Cost Price','Expiry','Date & Time']);
  getOrCreateSheet('Bills',             ['Bill ID','Patient Name','Doctor','Phone','Date','Subtotal','Discount','Total','Cost Total','Payment Mode','Date & Time']);
  getOrCreateSheet('BillItems',         ['Bill ID','Medicine ID','Medicine Name','Quantity','Unit Price','Cost Price','Amount','Date & Time']);
  getOrCreateSheet('Purchases',         ['ID','Date','Supplier','Medicine ID','Medicine Name','Quantity','Cost Price','Total Cost','Date & Time']);
  getOrCreateSheet('TreatmentReceipts', ['Receipt No','Date','Patient','Doctor','Amount','Amount in Words','Treatments','Saved At']);
  getOrCreateSheet('Prescriptions',     ['Date','Patient Name','Age','Sex','Prescription','Saved At']);
  getOrCreateSheet('Patients',          ['ID','Name','Phone','Age','Sex','Doctor','Treatment','Balance','Medical Alerts','Status','Last Visit','Added On']);
  getOrCreateSheet('Appointments',      ['ID','Patient','Phone','Date','Time','Reason','Doctor','Status','Booked At']);
  getOrCreateSheet('ExamForms',         ['Date','Patient','Age','Sex','Doctor','Phone','Swelling','TMJ','Lymph Nodes','Oral Hygiene','Gingiva','Dental Caries','Missing Teeth','Stains','Calculus','Provisional Diagnosis','Final Diagnosis','Treatment Plan','Treatment Notes','Upper Arch','Lower Arch','Saved At']);
  getOrCreateSheet('Settings',          ['Key','Value','Updated At']);
  getOrCreateSheet('Expenses',          ['ID','Date','Category','Amount','Vendor','Notes','Payment Mode','Added At']);
  SpreadsheetApp.flush();
  Logger.log('All sheets created/verified!');
}

// ════════════════════════════════════════════════════════════════════════════
// DAILY STOCK REPORT EMAIL
// Trigger: Time-based → Daily (runs automatically every day)
// ════════════════════════════════════════════════════════════════════════════
function sendDailyStockReport() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('Medicines');

    if (!sheet || sheet.getLastRow() <= 1) {
      Logger.log('No medicines data found.');
      return;
    }

    var data      = sheet.getDataRange().getValues();
    var today     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy');
    var now       = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM yyyy, hh:mm a');
    var todayDate = new Date();

    var outOfStock   = [];
    var lowStock     = [];
    var expiringSoon = [];
    var goodStock    = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;

      var name      = String(row[1] || '').trim();
      var stock     = parseInt(row[2])   || 0;
      var unitPrice = parseFloat(row[3]) || 0;
      var costPrice = parseFloat(row[4]) || 0;
      var expiryStr = formatDate(row[5]);
      var expiryDate = expiryStr ? new Date(expiryStr) : null;

      var daysLeft = null;
      if (expiryDate && !isNaN(expiryDate.getTime())) {
        daysLeft = Math.ceil((expiryDate - todayDate) / (1000 * 60 * 60 * 24));
      }

      var med = { name: name, stock: stock, unitPrice: unitPrice,
                  costPrice: costPrice, expiry: expiryStr, daysLeft: daysLeft };

      if (stock === 0)       outOfStock.push(med);
      else if (stock < 10)   lowStock.push(med);
      else                   goodStock.push(med);

      if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 60) {
        expiringSoon.push(med);
      }
    }

    lowStock.sort(function(a,b)     { return a.stock - b.stock; });
    goodStock.sort(function(a,b)    { return a.name.localeCompare(b.name); });
    expiringSoon.sort(function(a,b) { return a.daysLeft - b.daysLeft; });

    var totalMeds = outOfStock.length + lowStock.length + goodStock.length;
    var hasIssues = outOfStock.length > 0 || lowStock.length > 0 || expiringSoon.length > 0;
    var subject   = (hasIssues ? '⚠️' : '✅') + ' Daily Stock Report — Sri Sai Speciality Dental Care (' + today + ')';

    var html = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;background:#f5f7fa;padding:20px;">';

    html += '<div style="background:linear-gradient(135deg,#1e3f5a,#2c5aa0);padding:24px 28px;border-radius:12px 12px 0 0;">';
    html += '<h1 style="color:#fff;margin:0;font-size:22px;">🦷 Sri Sai Speciality Dental Care</h1>';
    html += '<p style="color:#b3d4f5;margin:6px 0 0;font-size:14px;">Daily Medicine Stock Report &nbsp;|&nbsp; ' + now + '</p>';
    html += '</div>';

    html += '<div style="background:#fff;padding:16px 20px;display:flex;gap:12px;flex-wrap:wrap;border-left:4px solid #2c5aa0;border-right:1px solid #e0e0e0;">';
    html += _statBox('Total Medicines', totalMeds,           '#2c5aa0');
    html += _statBox('Good Stock',      goodStock.length,    '#27ae60');
    html += _statBox('Low Stock',       lowStock.length,     lowStock.length    > 0 ? '#f39c12' : '#27ae60');
    html += _statBox('Out of Stock',    outOfStock.length,   outOfStock.length  > 0 ? '#e74c3c' : '#27ae60');
    html += _statBox('Expiring ≤60d',   expiringSoon.length, expiringSoon.length> 0 ? '#e67e22' : '#27ae60');
    html += '</div>';

    if (outOfStock.length > 0) {
      html += _sectionHeader('🔴 Out of Stock — Restock Immediately (' + outOfStock.length + ')', '#e74c3c');
      html += _tableStart(['Medicine Name','Expiry Date','Unit Price','Status'], '#fdecea', '#c0392b');
      outOfStock.forEach(function(m, i) {
        var bg = i % 2 === 0 ? '#fff' : '#fff8f8';
        html += '<tr style="background:' + bg + ';">';
        html += '<td style="padding:9px 14px;font-weight:700;font-size:13px;">' + m.name + '</td>';
        html += '<td style="padding:9px 14px;font-size:13px;color:#888;">' + (m.expiry || '—') + '</td>';
        html += '<td style="padding:9px 14px;font-size:13px;">₹' + m.unitPrice.toFixed(2) + '</td>';
        html += '<td style="padding:9px 14px;text-align:center;"><span style="background:#e74c3c;color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">OUT OF STOCK</span></td>';
        html += '</tr>';
      });
      html += '</table>';
    }

    if (lowStock.length > 0) {
      html += _sectionHeader('🟡 Low Stock — Order Soon (' + lowStock.length + ')', '#f39c12');
      html += _tableStart(['Medicine Name','Stock Left','Expiry Date','Unit Price'], '#fef9e7', '#b7770d');
      lowStock.forEach(function(m, i) {
        var bg = i % 2 === 0 ? '#fff' : '#fffde7';
        html += '<tr style="background:' + bg + ';">';
        html += '<td style="padding:9px 14px;font-weight:700;font-size:13px;">' + m.name + '</td>';
        html += '<td style="padding:9px 14px;text-align:center;"><span style="background:#f39c12;color:#fff;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">' + m.stock + ' units</span></td>';
        html += '<td style="padding:9px 14px;font-size:13px;color:#888;">' + (m.expiry || '—') + '</td>';
        html += '<td style="padding:9px 14px;font-size:13px;">₹' + m.unitPrice.toFixed(2) + '</td>';
        html += '</tr>';
      });
      html += '</table>';
    }

    if (expiringSoon.length > 0) {
      html += _sectionHeader('🟠 Expiring Within 60 Days (' + expiringSoon.length + ')', '#e67e22');
      html += _tableStart(['Medicine Name','Expiry Date','Days Left','Stock','Unit Price'], '#fef0e6', '#a04000');
      expiringSoon.forEach(function(m, i) {
        var bg = i % 2 === 0 ? '#fff' : '#fef5ee';
        var badgeColor = m.daysLeft <= 14 ? '#e74c3c' : m.daysLeft <= 30 ? '#f39c12' : '#e67e22';
        html += '<tr style="background:' + bg + ';">';
        html += '<td style="padding:9px 14px;font-weight:700;font-size:13px;">' + m.name + '</td>';
        html += '<td style="padding:9px 14px;font-size:13px;">' + m.expiry + '</td>';
        html += '<td style="padding:9px 14px;text-align:center;"><span style="background:' + badgeColor + ';color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">' + m.daysLeft + ' days</span></td>';
        html += '<td style="padding:9px 14px;font-size:13px;text-align:center;">' + m.stock + '</td>';
        html += '<td style="padding:9px 14px;font-size:13px;">₹' + m.unitPrice.toFixed(2) + '</td>';
        html += '</tr>';
      });
      html += '</table>';
    }

    html += _sectionHeader('📦 Complete Medicine Stock — All ' + totalMeds + ' Medicines', '#2c5aa0');
    html += _tableStart(['#','Medicine Name','Stock','Expiry Date','Unit Price','Cost Price','Status'], '#e8f0fe', '#1a3a6b');

    var allSorted = outOfStock.concat(lowStock).concat(goodStock);
    allSorted.forEach(function(m, i) {
      var bg = i % 2 === 0 ? '#fff' : '#f4f7ff';
      var stockBadge, stockColor;
      if (m.stock === 0)      { stockBadge = '0';           stockColor = '#e74c3c'; }
      else if (m.stock < 10)  { stockBadge = m.stock + '';  stockColor = '#f39c12'; }
      else if (m.stock < 30)  { stockBadge = m.stock + '';  stockColor = '#2980b9'; }
      else                    { stockBadge = m.stock + '';  stockColor = '#27ae60'; }
      var expiryDisplay = m.expiry || '—';
      var expiryStyle   = '';
      if (m.daysLeft !== null) {
        if (m.daysLeft <= 14)      expiryStyle = 'color:#e74c3c;font-weight:700;';
        else if (m.daysLeft <= 30) expiryStyle = 'color:#f39c12;font-weight:700;';
        else if (m.daysLeft <= 60) expiryStyle = 'color:#e67e22;font-weight:600;';
      }
      var statusLabel, statusColor;
      if (m.stock === 0)      { statusLabel = '🔴 Out of Stock'; statusColor = '#e74c3c'; }
      else if (m.stock < 10)  { statusLabel = '🟡 Low';          statusColor = '#f39c12'; }
      else if (m.stock < 30)  { statusLabel = '🔵 Moderate';     statusColor = '#2980b9'; }
      else                    { statusLabel = '🟢 Good';          statusColor = '#27ae60'; }
      html += '<tr style="background:' + bg + ';">';
      html += '<td style="padding:9px 14px;font-size:12px;color:#999;">' + (i + 1) + '</td>';
      html += '<td style="padding:9px 14px;font-weight:600;font-size:13px;">' + m.name + '</td>';
      html += '<td style="padding:9px 14px;text-align:center;"><span style="background:' + stockColor + ';color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">' + stockBadge + '</span></td>';
      html += '<td style="padding:9px 14px;font-size:13px;' + expiryStyle + '">' + expiryDisplay + '</td>';
      html += '<td style="padding:9px 14px;font-size:13px;text-align:right;">₹' + m.unitPrice.toFixed(2) + '</td>';
      html += '<td style="padding:9px 14px;font-size:13px;text-align:right;">₹' + m.costPrice.toFixed(2) + '</td>';
      html += '<td style="padding:9px 14px;font-size:12px;color:' + statusColor + ';font-weight:700;">' + statusLabel + '</td>';
      html += '</tr>';
    });
    html += '</table>';

    if (!hasIssues) {
      html += '<div style="background:#eafaf1;border:1.5px solid #27ae60;border-radius:8px;padding:16px 20px;margin:14px 0;text-align:center;">';
      html += '<p style="color:#1e8449;font-weight:700;font-size:15px;margin:0;">✅ All medicines are well-stocked — No alerts today!</p>';
      html += '</div>';
    }

    html += '<div style="background:#1e3f5a;padding:14px 24px;border-radius:0 0 12px 12px;margin-top:6px;text-align:center;">';
    html += '<p style="color:#b3d4f5;font-size:12px;margin:0;">Automated daily report from Sri Sai Speciality Dental Care clinic app &nbsp;|&nbsp; ' + now + '</p>';
    html += '</div></div>';

    var recipient = Session.getActiveUser().getEmail();
    GmailApp.sendEmail(
      recipient,
      subject,
      'Please open in an HTML email viewer to see the stock report.',
      { htmlBody: html, name: 'Sri Sai Dental — Stock Report' }
    );

    Logger.log('Daily stock report sent to: ' + recipient + ' | Medicines: ' + totalMeds);

  } catch(err) {
    Logger.log('sendDailyStockReport ERROR: ' + err.toString());
    throw err;
  }
}

// ── Email Helper Functions ────────────────────────────────────────────────
function _statBox(label, value, color) {
  return '<div style="flex:1;min-width:110px;background:#f8f9fa;border-radius:8px;padding:10px 14px;text-align:center;border-top:3px solid ' + color + ';">' +
    '<div style="font-size:24px;font-weight:800;color:' + color + ';">' + value + '</div>' +
    '<div style="font-size:11px;color:#666;margin-top:3px;">' + label + '</div>' +
    '</div>';
}

function _sectionHeader(title, color) {
  return '<div style="background:' + color + ';padding:10px 16px;margin-top:14px;">' +
    '<span style="color:#fff;font-weight:700;font-size:14px;">' + title + '</span>' +
    '</div>';
}

function _tableStart(headers, headerBg, headerColor) {
  var html = '<table style="width:100%;border-collapse:collapse;background:#fff;">';
  html += '<tr style="background:' + headerBg + ';">';
  headers.forEach(function(h) {
    html += '<th style="padding:9px 14px;text-align:left;font-size:12px;color:' + headerColor + ';font-weight:700;border-bottom:2px solid ' + headerColor + ';">' + h + '</th>';
  });
  html += '</tr>';
  return html;
}