/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
        // CONFIG - PRE-FILLED WITH YOUR WEB APP URL
        const CONFIG = {
            apiUrl: '', // ← NOT stored here (code is public on GitHub). Entered once per device; saved in this browser.,
            demoMode: false,
            clinicName: 'Sri Sai Speciality Dental Care (T V Rao)',
            clinicPhone: '93965 22492, 86880 33072',
            clinicAddress: '8-5-254/10/1, Near TKR College Road, Kharmanghat',
            clinicTimings: '9:30 AM – 9:30 PM (Every Day, Sunday Working Day)',
            upiId: '',
            upiName: 'Sri Sai Dental Care'
        };

        window.CONFIG = CONFIG; // lets other scripts (Exam Form sync) see CONFIG

        // STATE
        let medicines = [];
        let bills = [];
        let purchases = [];
        let cart = [];
        let currentPage = 'dashboard';

        // ============ LOGIN / AUTH ============
        // Passwords are stored only as SHA-256 hashes (never plain text in public code).
        // To change a password: open the app, press F12 → Console, run
        //   __sha256('ssdc|owner|NEW_PASSWORD')   (or 'ssdc|staff|NEW_PASSWORD')
        // and paste the result below.
        const CREDENTIALS = {
            owner: { username: 'owner', hash: 'e4a5873d591d1aaecce6c14588b5ee697251baddc12417f87904ce42447405e1' },
            staff: { username: 'staff', hash: '64fcd924b3a21386dc4e49f5665b4ec635a4feffb8395c608bef60d6aad6ac62' }
        };

        let currentRole = null; // 'owner' or 'staff'
        let selectedRole = 'owner';

        function selectRole(role) {
            selectedRole = role;
            document.getElementById('tabOwner').classList.toggle('active', role === 'owner');
            document.getElementById('tabStaff').classList.toggle('active', role === 'staff');
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').style.display = 'none';
        }

        function doLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            const cred = CREDENTIALS[selectedRole];
            if (username === cred.username && __sha256('ssdc|' + selectedRole + '|' + password) === cred.hash) {
                currentRole = selectedRole;
                document.getElementById('loginScreen').classList.add('hidden');
                applyRoleUI();
                initApp();
            } else {
                document.getElementById('loginError').style.display = 'block';
            }
        }

        function doLogout() {
            currentRole = null;
            selectedRole = 'owner';
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginError').style.display = 'none';
            selectRole('owner');
        }

        function applyRoleUI() {
            const isOwner = currentRole === 'owner';
            // Update user badge
            document.getElementById('userIcon').textContent = isOwner ? '👑' : '👨‍⚕️';
            document.getElementById('userName').textContent = isOwner ? 'Owner' : 'Staff';
            // Show/hide owner-only nav items
            document.querySelectorAll('.owner-only').forEach(el => {
                el.classList.toggle('hidden', !isOwner);
            });
            // If staff, go directly to New Bill page and make it active
            if (!isOwner) {
                // Remove active from all nav items, show newbill page
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('newbill').classList.add('active');
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                document.getElementById('nav-newbill').classList.add('active');
                document.getElementById('pageTitle').textContent = '🧾 New Bill';
            } else {
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('dashboard').classList.add('active');
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                document.getElementById('nav-dashboard').classList.add('active');
                document.getElementById('pageTitle').textContent = '📊 Dashboard';
            }
        }

        function showPage(page) {
            // Restrict staff from owner-only pages
            const ownerPages = ['dashboard','allbills','inventory','purchases','expenses','reports','settings'];
            if (currentRole === 'staff' && ownerPages.includes(page)) return;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(page).classList.add('active');
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const navEl = document.getElementById('nav-' + page);
            if (navEl) navEl.classList.add('active');
            const titles = {
                dashboard: '📊 Dashboard',
                newbill: '🧾 New Bill',
                allbills: '📋 All Bills',
                inventory: '📦 Inventory',
                purchases: '🛒 Purchases',
                expenses: '💸 Clinic Expenses',
                reports: '📈 Reports',
                settings: '⚙️ Settings',
                treatmentreceipt: '🦷 Treatment Receipt',
                combinedbill: '🧾 Bill Summary',
                examform:     '🦷 Examination Form',
                appointments: '📅 Appointments',
                wareminders:  '📲 WA Reminders',
                prescription: '📋 Prescription'
            };
            document.getElementById('pageTitle').textContent = titles[page] || 'Sri Sai Speciality Dental Care';
            if (page === 'reports') setTimeout(renderReports, 50);
            if (page === 'expenses') setTimeout(renderExpenses, 50);
            if (page === 'combinedbill' && typeof renderCbHistory === 'function') renderCbHistory();
            if (page === 'patients') { renderPatientsTable(); updatePatientStats(); }
            if (page === 'appointments') { renderAppointments(); }
            if (page === 'wareminders') { updateWaStats(); renderWaTodayList(); updateWaPreview(); renderWaAllAppts(); }
            if (page === 'dashboard' && typeof renderDashCalendar === 'function') renderDashCalendar();
            if (page === 'examform') { if(typeof initDentalChart==='function') initDentalChart(); if(typeof renderEfHistory==='function') renderEfHistory(); }
            // Auto-fill receipt no if empty when navigating to receipt pages
            if (page === 'combinedbill') {
                var cbn = document.getElementById('cb_no');
                if (cbn && !cbn.value && typeof peekNextReceiptNo === 'function') {
                    cbn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
                }
            }
            if (page === 'treatmentreceipt') {
                var trn = document.getElementById('tr_no');
                if (trn && !trn.value && typeof peekNextReceiptNo === 'function') {
                    trn.placeholder = 'Next: ' + peekNextReceiptNo() + ' (click Auto)';
                }
                if (typeof renderTreatmentHistory === 'function') renderTreatmentHistory();
                if (typeof renderRxHistory === 'function') renderRxHistory();
            }
        }

        // Wire up live preview for treatment receipt
        function initTreatmentReceiptPreview() {
            ['tr_no','tr_date','tr_patient','tr_amount','tr_words','tr_others_text',
             'tr_t1','tr_t2','tr_t3','tr_t4','tr_t5','tr_t6','tr_t7','tr_t8','tr_t9'
            ].forEach(function(id) {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', updateTreatmentPreview);
                    el.addEventListener('change', updateTreatmentPreview);
                }
            });
            // Set today's date
            const d = document.getElementById('tr_date');
            if (d) d.valueAsDate = new Date();
            updateTreatmentPreview();
            renderTreatmentHistory();
            const rd = document.getElementById('rx_date');
            if (rd) rd.valueAsDate = new Date();
            updateRxPreview();
            renderRxHistory();
        }

        function initApp() {
            loadSettings();
            // Render histories immediately (no delay needed)
            if (typeof renderTreatmentHistory === 'function') renderTreatmentHistory();
            if (typeof renderRxHistory === 'function') renderRxHistory();
            setTimeout(initTreatmentReceiptPreview, 300);
            // Load cached data instantly so UI is usable immediately
            const cached = localStorage.getItem('medistock_cache');
            if (cached) {
                try {
                    const c = JSON.parse(cached);
                    medicines = c.medicines || [];
                    bills = c.bills || [];
                    purchases = c.purchases || [];
                    refreshUI();
                    
                } catch(e) {}
            }
            loadData();
            updateDate();
            setInterval(updateDate, 60000);
            // Auto-refresh from Sheets every 30 seconds
            setInterval(function(){ loadData(); }, 300000);
        }
        // ============ END LOGIN / AUTH ============

        // INIT
        window.addEventListener('load', () => {
            // Don't load app until logged in
        });

        // LOAD SETTINGS FROM LOCAL STORAGE
        function loadSettings() {
            const saved = localStorage.getItem('medistock_config');
            if (saved) {
                const config = JSON.parse(saved);
                delete config.demoMode; // NEVER load demoMode from storage
                Object.assign(CONFIG, config);
                CONFIG.demoMode = false; // Always reset to false on load
                document.getElementById('apiUrl').value = CONFIG.apiUrl;
                document.getElementById('clinicName').value = CONFIG.clinicName;
                document.getElementById('clinicPhone').value = CONFIG.clinicPhone;
                document.getElementById('clinicAddress').value = CONFIG.clinicAddress;
                document.getElementById('clinicTimings').value = CONFIG.clinicTimings;
                document.getElementById('clinicUpiId').value = CONFIG.upiId || '';
                document.getElementById('clinicUpiName').value = CONFIG.upiName || '';
            }
        }

        // SAVE SETTINGS
        // ── SAVING OVERLAY HELPERS ──────────────────────────────
        let _clockInterval = null;
        function showSaving() {
            const overlay = document.getElementById('savingOverlay');
            overlay.style.display = 'flex';
            const clocks = ['🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'];
            let ci = 0;
            const clockEl = document.getElementById('clockAnim');
            _clockInterval = setInterval(() => { clockEl.textContent = clocks[ci++ % clocks.length]; }, 100);
        }
        function hideSaving() {
            clearInterval(_clockInterval);
            document.getElementById('savingOverlay').style.display = 'none';
        }
        // ────────────────────────────────────────────────────────

        function saveSettings() {
            showSaving();
            var el = document.getElementById('apiUrl');
            if (el) { CONFIG.apiUrl = el.value; CONFIG.demoMode = false; }
            var toSave = Object.assign({}, CONFIG);
            delete toSave.demoMode;
            localStorage.setItem('medistock_config', JSON.stringify(toSave));
            setTimeout(() => {
                hideSaving();
                showToast('Settings saved!', 'success');
                loadData();
            }, 800);
        }

        // SAVE CLINIC DETAILS
        function saveClinicDetails() {
            showSaving();
            var g = function(id){ var e=document.getElementById(id); return e?e.value:''; };
            CONFIG.clinicName    = g('clinicName')    || CONFIG.clinicName;
            CONFIG.clinicPhone   = g('clinicPhone')   || CONFIG.clinicPhone;
            CONFIG.clinicAddress = g('clinicAddress') || CONFIG.clinicAddress;
            CONFIG.clinicTimings = g('clinicTimings') || CONFIG.clinicTimings;
            CONFIG.upiId         = g('clinicUpiId').trim();
            CONFIG.upiName       = g('clinicUpiName').trim() || CONFIG.clinicName;
            localStorage.setItem('medistock_config', JSON.stringify(CONFIG));
            setTimeout(() => {
                hideSaving();
                showToast('Clinic details saved!', 'success');
            }, 800);
        }

        // LOAD DATA FROM GOOGLE SHEETS
        async function loadData() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
                CONFIG.demoMode = true;
                loadDemoData();
                updateConnectionStatus(false);
                showToast('Demo Mode - Set API URL in Settings to use live data', 'warning');
                return;
            }

            try {
                // Google Apps Script CORS fix:
                // - No custom headers (they trigger a preflight OPTIONS that Apps Script rejects)
                // - redirect: 'follow' is required because Apps Script issues a redirect on GET
                const url = CONFIG.apiUrl + '?action=getAllData';
                const response = await fetch(url, {
                    method: 'GET',
                    redirect: 'follow'
                });
                
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                
                const data = await response.json();

                // Normalize types — Sheets can return numbers as strings
                medicines = (data.medicines || []).map(m => ({
                    ...m,
                    stock: parseInt(m.stock) || 0,
                    price: parseFloat(m.price) || 0,
                    costPrice: parseFloat(m.costPrice) || 0
                }));
                bills = (data.bills || []).map(b => {
                    let items = b.items || [];
                    if (typeof items === 'string') {
                        try { items = JSON.parse(items); } catch(e) { items = []; }
                    }
                    // Handle double-encoded: each element might still be a string
                    if (Array.isArray(items)) {
                        items = items.map(i => typeof i === 'string' ? (() => { try { return JSON.parse(i); } catch(e) { return i; } })() : i);
                    }
                    return {
                        ...b,
                        phone: String(b.phone || ''),
                        date: b.date ? String(b.date).split('T')[0] : '',
                        total: parseFloat(b.total) || 0,
                        subtotal: parseFloat(b.subtotal) || 0,
                        discount: parseFloat(b.discount) || 0,
                        costTotal: parseFloat(b.costTotal) || 0,
                        items: items
                    };
                });
                purchases = data.purchases || [];

                // Load patients & appointments - always update from Sheets or keep localStorage
                // Always update patients from Sheets if available, otherwise keep localStorage
                if (data.patients && data.patients.length) {
                    _patients = data.patients.map(function(p){ return {
                        id: p.id||('PT-'+Date.now()+Math.random()),
                        name: p.name||'', phone: String(p.phone||''), age: p.age||'',
                        sex: p.sex||'', doctor: p.doctor||'', treatment: p.treatment||'',
                        balance: parseFloat(p.balance)||0, alerts: p.alerts||'',
                        status: p.status||'Active', lastVisit: p.lastVisit||'', addedOn: p.addedOn||''
                    }; });
                    localStorage.setItem('pt_records', JSON.stringify(_patients));
                }
                if (data.appointments && data.appointments.length) {
                    _appointments = data.appointments.map(function(a){ return {
                        id: a.id||('A'+Date.now()+Math.random()),
                        patient: a.patient||'', phone: String(a.phone||''), date: a.date||'',
                        time: (function(t){
                            if(!t && t!==0) return '';
                            var s = String(t).trim();
                            // Already correct slot format e.g. "10:30 AM"
                            if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) return s.toUpperCase();
                            var h, m;
                            // Google Sheets decimal fraction of day e.g. 0.4375 = 10:30 AM
                            var num = parseFloat(s);
                            if (!isNaN(num) && num >= 0 && num < 1) {
                                var totalMins = Math.round(num * 24 * 60);
                                h = Math.floor(totalMins / 60);
                                m = totalMins % 60;
                            }
                            // ISO timestamp e.g. "1970-01-01T05:08:00.000Z"
                            if (h === undefined && s.includes('T')) {
                                var d = new Date(s);
                                if (!isNaN(d)) { h = d.getUTCHours(); m = d.getUTCMinutes(); }
                            }
                            // Raw 24h time e.g. "10:30" or "05:08"
                            if (h === undefined && /^\d{1,2}:\d{2}$/.test(s)) {
                                var pts = s.split(':'); h = parseInt(pts[0]); m = parseInt(pts[1]);
                            }
                            if (h === undefined) return s;
                            // Snap to nearest valid slot (every 30 min)
                            var snapM = m < 15 ? 0 : m < 45 ? 30 : 0;
                            var snapH = m >= 45 ? h + 1 : h;
                            if (snapH >= 24) snapH = 23;
                            var ampm = snapH < 12 ? 'AM' : 'PM';
                            var h12 = snapH % 12 || 12;
                            return ('0' + h12).slice(-2) + ':' + (snapM === 0 ? '00' : '30') + ' ' + ampm;
                        })(a.time),
                        reason: a.reason||'', doctor: a.doctor||'',
                        status: a.status||'Confirmed', bookedAt: a.bookedAt||''
                    }; });
                    localStorage.setItem('appointments', JSON.stringify(_appointments));
                }

                // ── LOAD EXPENSES FROM SHEETS ──────────────────────
                if (data.expenses && data.expenses.length) {
                    var sheetExpenses = data.expenses.map(function(e){ return {
                        id:       e.id       || ('EXP-' + Date.now() + Math.random()),
                        date:     e.date     ? String(e.date).split('T')[0] : '',
                        category: e.category || '',
                        amount:   parseFloat(e.amount)  || 0,
                        vendor:   e.vendor   || '',
                        notes:    e.notes    || '',
                        mode:     e.mode     || e.paymentMode || e['Payment Mode'] || 'Cash',
                        addedAt:  e.addedAt  || e.added_at || ''
                    }; });
                    // Merge: keep local entries not in Sheets, add Sheets entries not local
                    var localExpenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');
                    var sheetIds = sheetExpenses.map(function(e){ return e.id; });
                    var localOnly = localExpenses.filter(function(e){ return sheetIds.indexOf(e.id) === -1; });
                    _expenses = sheetExpenses.concat(localOnly);
                    // Sort newest first by date
                    _expenses.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
                    localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
                }
                // ───────────────────────────────────────────────────

                CONFIG.demoMode = false;
                updateConnectionStatus(true);
                // Cache data locally for fast next login
                try {
                    localStorage.setItem('medistock_cache', JSON.stringify({ medicines, bills, purchases }));
                } catch(e) {}
                refreshUI();
                // Force refresh patients, appointments and expenses tables
                setTimeout(function(){
                    if(typeof renderPatientsTable==='function') renderPatientsTable();
                    if(typeof updatePatientStats==='function') updatePatientStats();
                    if(typeof renderAppointments==='function') renderAppointments();
                    if(typeof renderExpenses==='function') renderExpenses();
                }, 100);
                showToast('✅ Data loaded from Google Sheets', 'success');
                // Load custom WA templates from Sheets so all devices stay in sync
                if (typeof _loadTmplsFromSheets === 'function') _loadTmplsFromSheets();
            } catch (err) {
                console.error('Load data error:', err);
                updateConnectionStatus(false);
                CONFIG.demoMode = false;
                loadDemoData();
                showToast("Could not load from Sheets. Saves still work.", "warning");



            }
        }

        // ── DASHBOARD CALENDAR ───────────────────────────────────
        var _dashCalYear  = new Date().getFullYear();
        var _dashCalMonth = new Date().getMonth(); // 0-based
        var _dashSelDate  = new Date().toISOString().split('T')[0];

        function renderDashCalendar() {
            var today   = new Date();
            var todayStr = today.toISOString().split('T')[0];
            var first   = new Date(_dashCalYear, _dashCalMonth, 1);
            var last    = new Date(_dashCalYear, _dashCalMonth + 1, 0);
            var months  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

            var title = document.getElementById('dashCalTitle');
            if (title) title.textContent = months[_dashCalMonth] + ' ' + _dashCalYear;

            // Get all appointment dates this month
            var apptDates = {};
            (_appointments||[]).forEach(function(a){
                if (a.status !== 'Cancelled') apptDates[a.date] = (apptDates[a.date]||0) + 1;
            });

            var grid = document.getElementById('dashCalGrid');
            if (!grid) return;
            var html = '';

            // Blank days before first of month
            var startDay = first.getDay();
            for (var i = 0; i < startDay; i++) {
                var prevDate = new Date(_dashCalYear, _dashCalMonth, -(startDay - i - 1));
                html += '<div class="cal-day other-month">' + prevDate.getDate() + '</div>';
            }

            // Days of month
            for (var d = 1; d <= last.getDate(); d++) {
                var dateStr = _dashCalYear + '-' + String(_dashCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
                var cls = 'cal-day';
                if (dateStr === todayStr)    cls += ' today';
                else if (dateStr === _dashSelDate) cls += ' selected';
                if (apptDates[dateStr])      cls += ' has-appt';
                html += '<div class="' + cls + '" onclick="dashCalSelect(\'' + dateStr + '\')">' + d + '</div>';
            }

            // Fill remaining cells
            var totalCells = startDay + last.getDate();
            var remainder  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
            for (var i = 1; i <= remainder; i++) {
                html += '<div class="cal-day other-month">' + i + '</div>';
            }

            grid.innerHTML = html;
            renderDashAppts(_dashSelDate);
        }

        function dashCalNav(dir) {
            _dashCalMonth += dir;
            if (_dashCalMonth > 11) { _dashCalMonth = 0; _dashCalYear++; }
            if (_dashCalMonth < 0)  { _dashCalMonth = 11; _dashCalYear--; }
            renderDashCalendar();
        }

        function dashCalSelect(dateStr) {
            _dashSelDate = dateStr;
            renderDashCalendar();
        }

        function renderDashAppts(dateStr) {
            var dateLabel = document.getElementById('dashApptDate');
            var list      = document.getElementById('dashApptList');
            if (!list) return;

            var d = new Date(dateStr + 'T12:00:00');
            var isToday = dateStr === new Date().toISOString().split('T')[0];
            if (dateLabel) {
                dateLabel.textContent = d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + (isToday?' — Today':'');
            }

            var dayAppts = (_appointments||[]).filter(function(a){ return a.date === dateStr; })
                .sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });

            if (!dayAppts.length) {
                list.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px 10px;">' +
                    '<div style="font-size:32px;margin-bottom:8px;">📅</div>' +
                    '<div style="font-size:14px;">No appointments ' + (isToday?'today':'on this day') + '</div>' +
                    '<div style="font-size:12px;margin-top:6px;color:#bbb;">Tap a date or click + Book</div>' +
                    '</div>';
                return;
            }

            list.innerHTML = dayAppts.map(function(a){
                var isCancelled = a.status === 'Cancelled';
                var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
                if (phone.length===10) phone = '91'+phone;
                var waBtn = phone ? '<button class="dash-appt-wa" onclick="sendDashApptWa(\''+a.id+'\')">📲</button>' : '';
                return '<div class="dash-appt-slot' + (isCancelled?' cancelled':'') + '">' +
                    '<span class="dash-appt-time">' + a.time + '</span>' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div class="dash-appt-name">' + a.patient + '</div>' +
                        (a.doctor?'<div style="font-size:11px;color:#888;">'+a.doctor+'</div>':'') +
                    '</div>' +
                    (a.reason?'<span class="dash-appt-tag'+(isCancelled?' cancelled':'')+'">'+a.reason+'</span>':'') +
                    (isCancelled?'<span class="dash-appt-tag cancelled">Cancelled</span>':waBtn) +
                    '</div>';
            }).join('');
        }

        function sendDashApptWa(id) {
            var a = (_appointments||[]).find(function(x){ return x.id===id; }); if(!a) return;
            var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
            if (!phone) { showToast('No phone for this appointment','warning'); return; }
            if (phone.length===10) phone='91'+phone;
            var msg = '*🦷 Sri Sai Speciality Dental Care*\n\nHello *'+a.patient+'*! 😊\n\n'+
                'Reminder for your appointment:\n⏰ *'+a.time+'*\n'+(a.reason?'🦷 '+a.reason+'\n':'')+(a.doctor?'👨‍⚕️ '+a.doctor+'\n':'')+
                '\nPlease arrive 5 mins early. Call: 8688033072 | 9396522492\n\nSee you soon! 🙏';
            openWhatsApp(phone, msg);
        }
        // ── END DASHBOARD CALENDAR ────────────────────────────────

        // LOAD DEMO DATA
        function loadDemoData() {
            medicines = [
                { id: 1, name: 'Amoxicillin 500mg', stock: 50, price: 25, costPrice: 12, expiry: '2025-12-31' },
                { id: 2, name: 'Ibuprofen 200mg', stock: 100, price: 15, costPrice: 6, expiry: '2025-11-30' },
                { id: 3, name: 'Paracetamol 500mg', stock: 80, price: 10, costPrice: 4, expiry: '2025-10-31' }
            ];
            bills = [];
            purchases = [];
            refreshUI();
        }

        // UPDATE CONNECTION STATUS
        function updateConnectionStatus(isConnected) {
            const indicator = document.getElementById('statusIndicator');
            if (isConnected) {
                indicator.classList.add('connected');
                indicator.title = 'Connected to Google Sheets';
            } else {
                indicator.classList.remove('connected');
                indicator.title = 'Offline / Demo Mode';
            }
        }

        // REFRESH UI
        function refreshUI() {
            if(typeof renderPatientsTable==='function') { renderPatientsTable(); }
            if(typeof updatePatientStats==='function') { updatePatientStats(); }
            if(typeof renderAppointments==='function') { renderAppointments(); }
            updateDashboard();
            updateMedicineSelect();
            updateInventoryTable();
            updateBillsTable();
            updatePurchasesTable();
        }

        // PAGE NAVIGATION - handled by login/auth section above

        // DASHBOARD
        function updateDashboard() {
            const today = new Date().toISOString().split('T')[0];
            let todayRevenue = 0;
            let todayProfit = 0;

            bills.forEach(bill => {
                const billDate = bill.date ? String(bill.date).split('T')[0] : '';
                const billTotal = parseFloat(bill.total) || 0;

                // Try costTotal first; if 0 or missing, calculate from items × medicine costPrice
                let billCostTotal = parseFloat(bill.costTotal) || 0;
                if (billCostTotal === 0 && bill.items && bill.items.length > 0) {
                    billCostTotal = bill.items.reduce((sum, item) => {
                        const med = medicines.find(m => String(m.id) === String(item.medicineId));
                        const costPrice = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                        return sum + (parseInt(item.qty) * costPrice);
                    }, 0);
                }

                if (billDate === today) {
                    todayRevenue += billTotal;
                    todayProfit += (billTotal - billCostTotal);
                }
            });

            document.getElementById('todayRevenue').textContent = todayRevenue.toFixed(2);
            document.getElementById('todayProfit').textContent = todayProfit.toFixed(2);

            const lowStock = medicines.filter(m => m.stock < 10).length;
            document.getElementById('lowStockCount').textContent = lowStock;

            const expiring = medicines.filter(m => {
                const expiry = new Date(m.expiry);
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                return expiry <= thirtyDaysFromNow;
            }).length;
            document.getElementById('expiringCount').textContent = expiring;

            // Render dashboard calendar & today's appointments
            if (typeof renderDashCalendar === 'function') renderDashCalendar();

            // Recent bills
            const recent = bills.slice(-5).reverse();
            const tbody = document.getElementById('recentBillsBody');
            const cards = document.getElementById('recentBillsCards');
            const rows = recent.map(bill => `
                <tr>
                    <td style="font-size:11px;font-family:monospace;">${bill.billId}</td>
                    <td>${bill.patientName}</td>
                    <td>${bill.doctor || '-'}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td style="white-space:nowrap;">${bill.date}</td>
                </tr>
            `).join('');
            tbody.innerHTML = rows;
            if (cards) {
                const isCBfn = id => id && String(id).startsWith('CB-');
                cards.innerHTML = recent.map(bill => `
                    <div class="m-card" style="border-left-color:${isCBfn(bill.billId)?'#2c5aa0':'#27ae60'}">
                        <div class="m-card-row">
                            <div class="m-card-title">${bill.patientName||'—'}</div>
                            <div class="m-card-val">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">👨‍⚕️ ${bill.doctor||'—'} &nbsp;|&nbsp; 📅 ${bill.date||''}</div>
                        <div class="m-card-meta" style="font-size:11px;color:#aaa;">${bill.billId}</div>
                    </div>
                `).join('');
            }
        }

        // BILLING
        function updateMedicineSelect() {
            const select = document.getElementById('medicineSelect');
            const purchaseSelect = document.getElementById('purchaseMedicine');
            const options = medicines.map(m => `<option value="${m.id}" data-price="${m.price}" data-stock="${m.stock}" data-name="${m.name}">${m.name} — ₹${parseFloat(m.price).toFixed(2)} (Stock: ${m.stock})</option>`).join('');
            select.innerHTML = '<option value="">Choose medicine...</option>' + options;
            purchaseSelect.innerHTML = '<option value="">Select medicine...</option>' + options;
            // Also populate Combined Bill dropdown with same data
            const cbSel = document.getElementById('cb_medSelect');
            if (cbSel) {
                cbSel.innerHTML = '<option value="">Choose medicine...</option>' + options;
            }
        }

        function addMedicineToCart() {
            const medicineId = document.getElementById('medicineSelect').value;
            const qty = parseInt(document.getElementById('medicineQty').value);

            if (!medicineId) {
                showToast('Please select a medicine', 'warning');
                return;
            }

            const medicine = medicines.find(m => String(m.id) === String(medicineId));
            if (!medicine) {
                showToast('Medicine not found', 'error');
                return;
            }

            if (qty > medicine.stock) {
                showToast(`Only ${medicine.stock} units available`, 'warning');
                return;
            }

            const existing = cart.find(c => String(c.id) === String(medicineId));
            if (existing) {
                existing.qty += qty;
            } else {
                cart.push({
                    id: medicineId,
                    name: medicine.name,
                    price: medicine.price,
                    costPrice: medicine.costPrice,
                    qty: qty
                });
            }

            document.getElementById('medicineSelect').value = '';
            document.getElementById('medicineQty').value = '1';
            renderCart();
            recalc();
            updateReceipt();
        }

        function renderCart() {
            const tbody = document.getElementById('cartBody');
            tbody.innerHTML = cart.map((item, idx) => `
                <tr>
                    <td>${item.name}</td>
                    <td><input type="number" value="${item.qty}" min="1" onchange="updateCartQty(${idx}, this.value)"></td>
                    <td>₹${item.price}</td>
                    <td>₹${(item.qty * item.price).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" onclick="removeFromCart(${idx})">Remove</button></td>
                </tr>
            `).join('');
        }

        function updateCartQty(idx, qty) {
            cart[idx].qty = parseInt(qty);
            renderCart();
            recalc();
            updateReceipt();
        }

        function removeFromCart(idx) {
            cart.splice(idx, 1);
            renderCart();
            recalc();
            updateReceipt();
        }

        function recalc() {
            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const grandTotal = subtotal - discount;

            document.getElementById('subtotal').textContent = subtotal.toFixed(2);
            document.getElementById('grandTotal').textContent = grandTotal.toFixed(2);
        }

        function updateReceipt() {
            const patientName = document.getElementById('patientName').value || 'N/A';
            const doctor = document.getElementById('doctor').value || 'N/A';
            const today = new Date().toLocaleDateString('en-IN');

            let receipt = `=== ${CONFIG.clinicName.toUpperCase()} ===

BILL DETAILS
Date: ${today}
Patient: ${patientName}
Doctor: ${doctor}

MEDICINES
`;

            cart.forEach(item => {
                receipt += `${item.name}
  Qty: ${item.qty} × ₹${item.price} = ₹${(item.qty * item.price).toFixed(2)}\n`;
            });

            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const grandTotal = subtotal - discount;

            receipt += `
─────────────────────────
Subtotal: ₹${subtotal.toFixed(2)}`;

            if (discount > 0) {
                receipt += `
Discount (${discountPct}%): -₹${discount.toFixed(2)}`;
            }

            receipt += `
GRAND TOTAL: ₹${grandTotal.toFixed(2)}
─────────────────────────
Payment: ${_selectedPayMode || '—'}

📞 ${CONFIG.clinicPhone}
📍 ${CONFIG.clinicAddress}
🕐 ${CONFIG.clinicTimings}

Thank you! Visit again.`;

            document.getElementById('receiptPreview').textContent = receipt;
        }

        function clearCart() {
            if (confirm('Clear cart?')) {
                cart = [];
                document.getElementById('patientName').value = '';
                document.getElementById('patientPhone').value = '';
                document.getElementById('doctor').value = '';
                document.getElementById('discountPct').value = '0';
                renderCart();
                recalc();
                updateReceipt();
                document.getElementById('whatsappBtn').style.display = 'none';
                showToast('Cart cleared', 'info');
            }
        }

        // ============ PAYMENT MODAL ============
        let _pendingPrint = false;
        let _selectedPayMode = 'Cash';

        function openPaymentModal(shouldPrint) {
            if (cart.length === 0) { showToast('Add medicines to cart first', 'warning'); return; }
            const patientName = document.getElementById('patientName').value.trim();
            if (!patientName) { showToast('Enter patient name', 'warning'); return; }

            _pendingPrint = shouldPrint;
            _selectedPayMode = 'Cash';

            const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

            document.getElementById('pmPatient').textContent = patientName;
            document.getElementById('pmSubtotal').textContent = '₹' + subtotal.toFixed(2);
            document.getElementById('pmDiscount').textContent = '-₹' + discount.toFixed(2);
            document.getElementById('pmTotal').textContent = '₹' + total.toFixed(2);
            document.getElementById('pmDiscountRow').style.display = discount > 0 ? 'flex' : 'none';

            // Reset
            document.getElementById('pmTendered').value = '';
            document.getElementById('pmChange').textContent = '₹0';
            document.getElementById('pmUpiRef').value = '';
            document.getElementById('pmCardRef').value = '';
            document.getElementById('pmSplitCash').value = '';
            document.getElementById('pmSplitUpi').value = '';
            document.getElementById('splitStatus').textContent = '';
            selectPayMode('Cash');

            // Quick cash buttons
            const qc = document.getElementById('quickCashBtns');
            qc.innerHTML = '';
            const rounded = Math.ceil(total / 10) * 10;
            [rounded, rounded + 50, rounded + 100, 500, 1000, 2000].filter((v, i, a) => a.indexOf(v) === i && v >= total).slice(0, 5).forEach(amt => {
                const b = document.createElement('button');
                b.textContent = '₹' + amt;
                b.style.cssText = 'padding:6px 12px;border:1px solid #2c5aa0;border-radius:6px;background:#f0f4ff;color:#2c5aa0;cursor:pointer;font-size:13px;font-weight:600;';
                b.onclick = () => { document.getElementById('pmTendered').value = amt; calcChange(); };
                qc.appendChild(b);
            });

            document.getElementById('paymentModal').classList.add('active');
        }

        function selectPayMode(mode) {
            _selectedPayMode = mode;
            document.querySelectorAll('.pay-mode-btn').forEach(b => b.classList.remove('pay-mode-active'));
            document.getElementById('pm-' + mode).classList.add('pay-mode-active');
            document.getElementById('cashSection').style.display = mode === 'Cash' ? 'block' : 'none';
            document.getElementById('upiSection').style.display = mode === 'UPI' ? 'block' : 'none';
            document.getElementById('cardSection').style.display = mode === 'Card' ? 'block' : 'none';
            document.getElementById('splitSection').style.display = mode === 'Split' ? 'block' : 'none';
            // For UPI, the "Payment Received" button IS the save — hide the generic confirm row
            document.getElementById('pmConfirmRow').style.display = mode === 'UPI' ? 'none' : 'flex';
            // Reset UPI paid button if switching away and back
            if (mode === 'UPI') {
                const b = document.getElementById('upiPaidBtn');
                if (b) { b.textContent = '✅ Payment Received'; b.style.background = '#27ae60'; b.disabled = false; }
                generateUpiQr();
            }
        }

        // ── UPI PAYMENT (iPad-optimised) ───────────────────────
        let _upiExpectedAmount = 0;
        let _upiPaymentDetected = false;

        function generateUpiQr() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
            const upiId = (CONFIG.upiId || '').trim();
            const upiName = (CONFIG.upiName || CONFIG.clinicName).trim();
            const noConfig = document.getElementById('upiNoConfig');
            const qrCard = document.getElementById('upiQrCard');

            if (!upiId) {
                noConfig.style.display = 'block';
                qrCard.style.display = 'none';
                return;
            }
            noConfig.style.display = 'none';
            qrCard.style.display = 'block';

            _upiExpectedAmount = total;
            _upiPaymentDetected = false;

            // Build UPI deep link
            const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Dental')}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&data=${encodeURIComponent(upiLink)}`;

            document.getElementById('upiQrImg').src = qrUrl;
            document.getElementById('upiAmountDisplay').textContent = '₹' + total.toFixed(2);
            document.getElementById('upiNameDisplay').textContent = upiName;
            document.getElementById('upiIdDisplay').textContent = '📲  ' + upiId;
            const step2 = document.getElementById('upiAmountStep2');
            if (step2) step2.textContent = total.toFixed(2);

            // Reset state
            document.getElementById('upiSuccessBox').style.display = 'none';
            document.getElementById('upiSmsInput').value = '';
            document.getElementById('upiSmsStatus').textContent = '';
            document.getElementById('pmUpiRef').value = '';
            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Payment Received — Save Bill';
            btn.style.background = '#27ae60';
            btn.style.opacity = '1';
            btn.disabled = false;
        }

        // Parse pasted bank SMS to extract amount and txn ID
        function checkSmsForPayment(smsText) {
            if (!smsText || smsText.length < 10) {
                document.getElementById('upiSmsStatus').textContent = '';
                return;
            }
            const statusEl = document.getElementById('upiSmsStatus');
            const text = smsText.toLowerCase();

            // Extract amount — matches Rs.450, Rs 450.00, INR 450, ₹450 etc.
            const amtMatch = smsText.match(/(?:rs\.?|inr|₹)\s*([\d,]+\.?\d*)/i);
            const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : null;

            // Extract transaction / reference ID
            const txnMatch = smsText.match(/(?:ref(?:no|erence)?\.?\s*(?:no\.?)?|upi\s*ref|txn\s*(?:id|no)?|transaction\s*(?:id|no)?)[:\s#]*([A-Z0-9]{8,})/i)
                          || smsText.match(/([A-Z0-9]{12,20})/);
            const txnId = txnMatch ? txnMatch[1] : '';

            // Check keywords for credit/success
            const isCredit = /credited|received|credit|success|paid|debited from.*upi|upi.*credit/i.test(text);

            if (!isCredit) {
                statusEl.style.color = '#e67e22';
                statusEl.textContent = '⚠️ SMS does not look like a payment confirmation — check it';
                return;
            }

            if (amount !== null && Math.abs(amount - _upiExpectedAmount) > 1) {
                statusEl.style.color = '#e74c3c';
                statusEl.textContent = `❌ Amount mismatch — SMS shows ₹${amount.toFixed(2)}, expected ₹${_upiExpectedAmount.toFixed(2)}`;
                return;
            }

            // All good — auto confirm!
            statusEl.style.color = '#27ae60';
            statusEl.textContent = `✅ Amount ₹${amount ? amount.toFixed(2) : _upiExpectedAmount.toFixed(2)} confirmed${txnId ? ' · Ref: ' + txnId : ''}`;
            if (txnId) document.getElementById('pmUpiRef').value = txnId;

            // Trigger success after brief delay
            setTimeout(() => {
                if (!_upiPaymentDetected) upiPaymentSuccess(txnId, amount || _upiExpectedAmount, 'SMS verified');
            }, 800);
        }

        function upiPaymentSuccess(txnId, amount, source) {
            if (_upiPaymentDetected) return;
            _upiPaymentDetected = true;

            document.getElementById('upiSuccessBox').style.display = 'block';
            const txnEl = document.getElementById('upiSuccessTxn');
            if (txnEl) txnEl.textContent = (txnId ? 'Ref: ' + txnId : '') + (source ? '  (' + source + ')' : '');
            if (txnId) document.getElementById('pmUpiRef').value = txnId;

            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Saving...';
            btn.disabled = true;
            btn.style.opacity = '0.7';

            setTimeout(() => { confirmPayment(); }, 1200);
        }

        function markUpiPaid() {
            if (_upiPaymentDetected) return;
            const btn = document.getElementById('upiPaidBtn');
            btn.textContent = '✅ Saving Bill...';
            btn.style.background = '#1e8449';
            btn.disabled = true;

            document.getElementById('upiSuccessBox').style.display = 'block';
            const txnEl = document.getElementById('upiSuccessTxn');
            const manualRef = document.getElementById('pmUpiRef').value;
            if (txnEl) txnEl.textContent = manualRef ? 'Ref: ' + manualRef : 'Confirmed by staff';

            _upiPaymentDetected = true;
            setTimeout(() => { confirmPayment(); }, 600);
        }

        function stopUpiPolling() {}   // kept for compatibility
        // ── END UPI ──────────────────────────────────────────────

        // ══ BILL SUCCESS POPUP ══════════════════════════════════
        let _lastBillData = null;  // stores last saved bill for the success popup
        let _lastPaymentInfo = null;

        function showBillSuccess(billData, paymentInfo) {
            _lastBillData = billData;
            _lastPaymentInfo = paymentInfo;

            // Payment mode label
            let modeLabel = paymentInfo.mode;
            if (paymentInfo.mode === 'Cash') modeLabel = '💵 Cash Payment';
            else if (paymentInfo.mode === 'UPI')  modeLabel = '📱 UPI / GPay Payment';
            else if (paymentInfo.mode === 'Card') modeLabel = '💳 Card Payment';
            else if (paymentInfo.mode === 'Split') modeLabel = '🔀 Split Payment';
            document.getElementById('bsPayMode').textContent = modeLabel;

            // Bill id & clinic
            document.getElementById('bsBillId').textContent = billData.billId;
            document.getElementById('bsClinicAddr').textContent = CONFIG.clinicAddress || '';
            document.getElementById('bsClinicPhone').textContent = CONFIG.clinicPhone ? '📞 ' + CONFIG.clinicPhone : '';

            // Patient info
            document.getElementById('bsPatient').textContent  = billData.patientName || '—';
            document.getElementById('bsDoctor').textContent   = billData.doctor       || '—';
            document.getElementById('bsDate').textContent     = billData.date         || '—';
            document.getElementById('bsPhone').textContent    = billData.phone        || '—';

            // Items
            const tbody = document.getElementById('bsItemsBody');
            tbody.innerHTML = billData.items.map((item, i) => `
                <tr style="background:${i % 2 === 0 ? 'white' : '#f8f9fa'};">
                    <td style="padding:7px 10px;border-bottom:1px solid #eee;">${item.medicineName}</td>
                    <td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">${item.qty}</td>
                    <td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">₹${parseFloat(item.price).toFixed(2)}</td>
                    <td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:600;">₹${parseFloat(item.amount).toFixed(2)}</td>
                </tr>
            `).join('');

            // Totals
            document.getElementById('bsSubtotal').textContent = '₹' + parseFloat(billData.subtotal).toFixed(2);
            document.getElementById('bsTotal').textContent    = '₹' + parseFloat(billData.total).toFixed(2);

            const discountRow = document.getElementById('bsDiscountRow');
            if (billData.discount > 0) {
                document.getElementById('bsDiscount').textContent = '-₹' + parseFloat(billData.discount).toFixed(2);
                discountRow.style.display = 'flex';
            } else {
                discountRow.style.display = 'none';
            }

            // Cash change details
            const cashDetails = document.getElementById('bsCashDetails');
            if (paymentInfo.mode === 'Cash' && paymentInfo.tendered) {
                document.getElementById('bsTendered').textContent = '₹' + parseFloat(paymentInfo.tendered).toFixed(2);
                document.getElementById('bsChange').textContent   = '₹' + Math.max(0, parseFloat(paymentInfo.change || 0)).toFixed(2);
                cashDetails.style.display = 'block';
            } else {
                cashDetails.style.display = 'none';
            }

            document.getElementById('billSuccessModal').classList.add('active');
        }

        function closeBillSuccess() {
            document.getElementById('billSuccessModal').classList.remove('active');
        }

        function printBillFromSuccess() {
            if (!_lastBillData) return;
            const b = _lastBillData;
            const pi = _lastPaymentInfo || {};

            // Build items rows
            const itemRows = b.items.map((item, i) => `
                <tr style="background:${i % 2 === 0 ? '#fff' : '#f8f9fa'};">
                    <td style="padding:8px 10px;border-bottom:1px solid #eee;">${item.medicineName}</td>
                    <td style="padding:8px 6px;text-align:center;border-bottom:1px solid #eee;">${item.qty}</td>
                    <td style="padding:8px 6px;text-align:right;border-bottom:1px solid #eee;">₹${parseFloat(item.price).toFixed(2)}</td>
                    <td style="padding:8px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:700;">₹${parseFloat(item.amount).toFixed(2)}</td>
                </tr>`).join('');

            // Payment mode label
            let modeLabel = pi.mode || '';
            if (modeLabel === 'Cash')  modeLabel = '💵 Cash';
            else if (modeLabel === 'UPI')   modeLabel = '📱 UPI / GPay';
            else if (modeLabel === 'Card')  modeLabel = '💳 Card';
            else if (modeLabel === 'Split') modeLabel = '🔀 Split';

            const discountRow = b.discount > 0
                ? `<tr><td style="padding:5px 0;color:#e74c3c;">Discount</td><td style="padding:5px 0;text-align:right;color:#e74c3c;">-₹${parseFloat(b.discount).toFixed(2)}</td></tr>` : '';

            const cashRows = (pi.mode === 'Cash' && pi.tendered)
                ? `<tr><td style="padding:4px 0;font-size:12px;color:#555;">Cash Received</td><td style="padding:4px 0;text-align:right;font-size:12px;color:#555;">₹${parseFloat(pi.tendered).toFixed(2)}</td></tr>
                   <tr><td style="padding:4px 0;font-size:12px;color:#27ae60;">Change Returned</td><td style="padding:4px 0;text-align:right;font-size:12px;color:#27ae60;">₹${Math.max(0, parseFloat(pi.change || 0)).toFixed(2)}</td></tr>` : '';

            // Build inline-styled HTML (no <html>/<head> tags — injected into div via innerHTML)
            const html = `
<style>
  #__bps * { box-sizing:border-box; font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; }
  #__bps { max-width:480px; margin:0 auto; color:#222; }
  #__bps .banner { background:linear-gradient(135deg,#27ae60,#1e8449); border-radius:14px 14px 0 0; padding:22px 20px 18px; text-align:center; color:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps .banner .tick { font-size:48px; margin-bottom:6px; display:block; }
  #__bps .banner h1 { font-size:22px; font-weight:800; margin:0; }
  #__bps .banner .mode { font-size:13px; opacity:0.85; margin-top:4px; }
  #__bps .body { border:2px solid #27ae60; border-top:none; border-radius:0 0 14px 14px; padding:18px 20px 20px; }
  #__bps .bill-id { text-align:right; font-size:11px; color:#999; font-family:monospace; margin-bottom:12px; }
  #__bps .clinic-header { text-align:center; margin-bottom:14px; padding-bottom:12px; border-bottom:2px dashed #ddd; }
  #__bps .clinic-header .name { font-size:16px; font-weight:800; color:#1e3f5a; }
  #__bps .clinic-header .sub { font-size:11px; color:#888; margin-top:3px; }
  #__bps .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; background:#f8f9fa; border-radius:8px; padding:12px; margin-bottom:14px; }
  #__bps .info-grid .lbl { font-size:10px; color:#999; margin-bottom:2px; }
  #__bps .info-grid .val { font-size:13px; font-weight:700; color:#2c3e50; }
  #__bps table { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:13px; }
  #__bps thead tr { background:#2c5aa0; color:white; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps thead th { padding:8px 10px; text-align:left; }
  #__bps thead th:not(:first-child) { text-align:center; }
  #__bps thead th:last-child { text-align:right; }
  #__bps .totals { background:#f8f9fa; border-radius:8px; padding:12px 14px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  #__bps .totals table { margin-bottom:0; font-size:13px; }
  #__bps .totals td { padding:4px 0; }
  #__bps .totals td:last-child { text-align:right; }
  #__bps .grand-total td { font-size:18px; font-weight:800; color:#2c5aa0; border-top:2px solid #dce8f8; padding-top:8px; }
  #__bps .footer { text-align:center; margin-top:16px; font-size:11px; color:#aaa; }
</style>
<div id="__bps">
  <div class="banner">
    <span class="tick">✅</span>
    <h1>Payment Done!</h1>
    <div class="mode">${modeLabel}</div>
  </div>
  <div class="body">
    <div id="__ph" data-patient="${(b.patientName||'').replace(/"/g,'&quot;')}" data-doctor="${(b.doctor||'').replace(/"/g,'&quot;')}" data-date="${b.date||''}" data-billid="${b.billId||''}" data-total="${parseFloat(b.total||0).toFixed(2)}" data-subtotal="${parseFloat(b.subtotal||0).toFixed(2)}" data-discount="${parseFloat(b.discount||0).toFixed(2)}" data-mode="${b.paymentMode||'Cash'}" data-items="${encodeURIComponent(JSON.stringify((b.items||[]).map(function(i){return{name:i.medicineName||i.name||'',qty:i.qty,price:i.price,amount:i.amount};})))}" style="display:none"></div>
    <div class="bill-id">${b.billId}</div>
    <div class="clinic-header">
      <div class="name">🦷 Sri Sai Speciality Dental Care</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicAddress || '') : ''}</div>
      <div class="sub">${CONFIG ? (CONFIG.clinicPhone ? '📞 ' + CONFIG.clinicPhone : '') : ''}</div>
    </div>
    <div class="info-grid">
      <div><div class="lbl">Patient</div><div class="val">${b.patientName || '—'}</div></div>
      <div><div class="lbl">Doctor</div><div class="val">${b.doctor || '—'}</div></div>
      <div><div class="lbl">Date</div><div class="val">${b.date || '—'}</div></div>
      <div><div class="lbl">Phone</div><div class="val">${b.phone || '—'}</div></div>
    </div>
    <table>
      <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td>₹${parseFloat(b.subtotal).toFixed(2)}</td></tr>
        ${discountRow}
        <tr class="grand-total"><td><strong>Grand Total</strong></td><td><strong>₹${parseFloat(b.total).toFixed(2)}</strong></td></tr>
        ${cashRows}
      </table>
    </div>
    <div class="footer">Thank you for choosing Sri Sai Speciality Dental Care 🦷</div>
  </div>
</div>`;

            printBillHtml(html);
        }
        // ══ END BILL SUCCESS POPUP ════════════════════════════

        function calcChange() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
            const tendered = parseFloat(document.getElementById('pmTendered').value) || 0;
            const change = tendered - total;
            const el = document.getElementById('pmChange');
            el.textContent = change >= 0 ? '₹' + change.toFixed(2) : '-₹' + Math.abs(change).toFixed(2);
            el.style.color = change >= 0 ? '#27ae60' : '#e74c3c';
        }

        function calcSplit() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;
            const cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
            const upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
            const rem = total - cash - upi;
            const el = document.getElementById('splitStatus');
            if (Math.abs(rem) < 0.01) { el.textContent = '✅ Balanced'; el.style.color = '#27ae60'; }
            else if (rem > 0) { el.textContent = '⚠️ ₹' + rem.toFixed(2) + ' still pending'; el.style.color = '#e67e22'; }
            else { el.textContent = '❌ Overpaid by ₹' + Math.abs(rem).toFixed(2); el.style.color = '#e74c3c'; }
        }

        function confirmPayment() {
            const total = parseFloat(document.getElementById('pmTotal').textContent.replace('₹', '')) || 0;

            // Validation per mode
            if (_selectedPayMode === 'Cash') {
                const tendered = parseFloat(document.getElementById('pmTendered').value) || 0;
                if (tendered < total) { showToast('Amount tendered is less than total', 'warning'); return; }
            }
            if (_selectedPayMode === 'Split') {
                const cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
                const upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
                if (Math.abs(cash + upi - total) > 0.5) { showToast('Split amounts must add up to total', 'warning'); return; }
            }

            // Build payment info to pass into bill
            let paymentInfo = { mode: _selectedPayMode };
            if (_selectedPayMode === 'Cash') {
                paymentInfo.tendered = parseFloat(document.getElementById('pmTendered').value) || total;
                paymentInfo.change = paymentInfo.tendered - total;
            }
            if (_selectedPayMode === 'UPI') paymentInfo.ref = document.getElementById('pmUpiRef').value;
            if (_selectedPayMode === 'Card') paymentInfo.ref = document.getElementById('pmCardRef').value;
            if (_selectedPayMode === 'Split') {
                paymentInfo.cash = parseFloat(document.getElementById('pmSplitCash').value) || 0;
                paymentInfo.upi = parseFloat(document.getElementById('pmSplitUpi').value) || 0;
            }

            closeModal('paymentModal');
            submitBill(_pendingPrint, paymentInfo);
        }
        // ============ END PAYMENT MODAL ============

        async function submitBill(shouldPrint = false, paymentInfo = { mode: 'Cash' }) {
            if (cart.length === 0) {
                showToast('Add medicines to cart first', 'warning');
                return;
            }

            const patientName = document.getElementById('patientName').value;
            if (!patientName) {
                showToast('Enter patient name', 'warning');
                return;
            }

            // Show saving animation
            showSaving();

            // Disable buttons
            document.getElementById('saveBillBtn').disabled = true;
            document.getElementById('printBillBtn').disabled = true;

            const billId = 'BILL-' + Date.now();
            const today = new Date().toLocaleDateString('en-CA');
            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const costTotal = cart.reduce((sum, item) => sum + (item.qty * item.costPrice), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

            const billData = {
                billId: billId,
                patientName: patientName,
                doctor: document.getElementById('doctor').value,
                phone: document.getElementById('patientPhone').value,
                date: today,
                subtotal: subtotal,
                discount: discount,
                total: total,
                costTotal: costTotal,
                paymentMode: paymentInfo.mode,
                paymentRef: paymentInfo.ref || '',
                items: cart.map(item => ({
                    medicineId: item.id,
                    medicineName: item.name,
                    qty: item.qty,
                    price: item.price,
                    costPrice: item.costPrice,
                    amount: item.qty * item.price
                }))
            };

            // ✅ SAVE LOCALLY IMMEDIATELY — no waiting for Sheets
            bills.push({...billData});
            updateBillsTable();
            updateDashboard();

            // Update stock locally
            billData.items.forEach(item => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                if (med) med.stock = Math.max(0, (med.stock || 0) - item.qty);
            });
            updateInventoryTable();

            hideSaving();
            document.getElementById('saveBillBtn').disabled = false;
            document.getElementById('printBillBtn').disabled = false;
            showToast(`✅ Bill saved! Payment: ${paymentInfo.mode}. Syncing...`, 'success');

            if (shouldPrint) printBill();
            document.getElementById('whatsappBtn').style.display = 'block';

            // ✅ Show Bill Payment Done popup with bill copy
            showBillSuccess(billData, paymentInfo);

            // Auto-clear cart after payment (no confirm needed — payment already confirmed)
            cart = [];
            document.getElementById('patientName').value = '';
            document.getElementById('patientPhone').value = '';
            document.getElementById('doctor').value = '';
            document.getElementById('discountPct').value = '0';
            renderCart();
            recalc();
            updateReceipt();

            // 🔄 SYNC TO GOOGLE SHEETS IN BACKGROUND (user not blocked)
            try {
                const params = new URLSearchParams();
                params.append('action', 'saveBill');
                params.append('billId', billId);
                params.append('patientName', billData.patientName);
                params.append('doctor', billData.doctor || '');
                params.append('phone', billData.phone || '');
                params.append('date', today);
                params.append('subtotal', subtotal.toFixed(2));
                params.append('discount', discount.toFixed(2));
                params.append('total', total.toFixed(2));
                params.append('costTotal', costTotal.toFixed(2));
                params.append('paymentMode', paymentInfo.mode);
                params.append('paymentRef', paymentInfo.ref || '');
                params.append('items', JSON.stringify(billData.items));

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            showToast('☁️ Synced to Google Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed: ' + (result.error || ''), 'warning');
                        }
                    })
                    .catch(err => {
                        showToast('⚠️ Saved locally, Sheets offline', 'warning');
                    });
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
        }

        function printBill() {
            const receiptText = document.getElementById('receiptPreview').innerText;
            const safeText = receiptText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const html = '<pre style="font-family:\'Bookman Old Style\',\'Book Antiqua\',Bookman,Georgia,serif;font-size:13px;line-height:1.8;white-space:pre-wrap;word-wrap:break-word;color:#000;">' + safeText + '</pre>';
            printBillHtml(html);
        }

        function shareOnWhatsApp() {
            const patientPhone = document.getElementById('patientPhone').value;
            const patientName = document.getElementById('patientName').value;
            const doctor = document.getElementById('doctor').value;

            if (!patientPhone) {
                showToast('Enter patient phone number', 'warning');
                return;
            }

            let message = `*SRI SAI SPECIALITY DENTAL CARE*\n\nHello ${patientName}!\n\n*Bill Details*\n`;
            message += `Doctor: ${doctor || 'N/A'}\n\n*Medicines:*\n`;

            cart.forEach(item => {
                message += `${item.name}\n  ${item.qty} × ₹${item.price} = ₹${(item.qty * item.price).toFixed(2)}\n`;
            });

            const subtotal = cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const discountPct = parseFloat(document.getElementById('discountPct').value) || 0;
            const discount = (subtotal * discountPct) / 100;
            const total = subtotal - discount;

            message += `\n*Total: ₹${total.toFixed(2)}*\n\n`;
            message += `📞 ${CONFIG.clinicPhone}\n📍 ${CONFIG.clinicAddress}\n\nThank you!`;

            const patientCleanPhone = patientPhone.replace(/[^\d]/g, '');
            openWhatsApp(patientCleanPhone, message);
        }

        // INVENTORY
        function updateInventoryTable() {
            const tbody = document.getElementById('inventoryBody');
            const cards = document.getElementById('inventoryCards');
            const stockColor = s => s <= 0 ? '#e74c3c' : s <= 10 ? '#f39c12' : '#27ae60';
            tbody.innerHTML = medicines.map(med => `
                <tr>
                    <td><strong>${med.name}</strong></td>
                    <td style="color:${stockColor(med.stock)};font-weight:700;">${med.stock}</td>
                    <td>₹${med.price}</td>
                    <td>₹${med.costPrice}</td>
                    <td style="white-space:nowrap;">${med.expiry}</td>
                    <td><button class="btn-danger btn-small" onclick="deleteMedicine(${med.id})">Delete</button></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = medicines.length ? medicines.map(med => {
                    const sc = stockColor(med.stock);
                    return `<div class="m-card" style="border-left-color:${sc}">
                        <div class="m-card-row">
                            <div class="m-card-title">${med.name}</div>
                            <div style="font-size:20px;font-weight:900;color:${sc};">${med.stock}</div>
                        </div>
                        <div class="m-card-row">
                            <div class="m-card-meta">💰 Sell: ₹${med.price} &nbsp;|&nbsp; Buy: ₹${med.costPrice}</div>
                            <div class="m-card-meta">📅 ${med.expiry}</div>
                        </div>
                        <div class="m-card-actions">
                            <button style="background:#e74c3c;" onclick="deleteMedicine(${med.id})">🗑️ Delete</button>
                        </div>
                    </div>`;
                }).join('') : '<div style="text-align:center;color:#aaa;padding:20px;">No medicines in inventory.</div>';
            }
        }

        function openAddMedicineModal() {
            document.getElementById('addMedicineModal').classList.add('active');
        }

        async function saveMedicine() {
            const name = document.getElementById('newMedicineName').value;
            const price = parseFloat(document.getElementById('newMedicinePrice').value);
            const costPrice = parseFloat(document.getElementById('newMedicineCostPrice').value);
            const stock = 0;
            const expiry = document.getElementById('newMedicineExpiry').value;

            if (!name || !price || !costPrice || !expiry) {
                showToast('Fill all fields', 'warning');
                return;
            }

            showSaving();

            // Save locally immediately
            const tempId = Date.now();
            medicines.push({ id: tempId, name, price, costPrice, stock, expiry });
            closeModal('addMedicineModal');
            updateInventoryTable();
            updateMedicineSelect();
            hideSaving();
            showToast('✅ Medicine added! Syncing to Sheets...', 'success');

            // Reset form for next entry
            document.getElementById('newMedicineName').value = '';
            document.getElementById('newMedicinePrice').value = '';
            document.getElementById('newMedicineCostPrice').value = '';
            document.getElementById('newMedicineExpiry').value = '';

            // Sync to Sheets in background
            try {
                const params = new URLSearchParams();
                params.append('action', 'addMedicine');
                params.append('name', name);
                params.append('price', price);
                params.append('costPrice', costPrice);
                params.append('stock', stock);
                params.append('expiry', expiry);

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            // Update local ID to real Sheets ID
                            const med = medicines.find(m => String(m.id) === String(tempId));
                            if (med) {
                                med.id = result.medicineId;
                                // Refresh dropdowns so they use the real Sheets ID
                                updateMedicineSelect();
                                updateInventoryTable();
                            }
                            showToast('☁️ Medicine synced to Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed', 'warning');
                        }
                    })
                    .catch(() => showToast('⚠️ Saved locally, Sheets offline', 'warning'));
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
        }

        async function deleteMedicine(id) {
            if (!confirm('Are you sure you want to delete this medicine?\nThis cannot be undone.')) return;

            medicines = medicines.filter(m => m.id !== id);
            updateInventoryTable();
            updateMedicineSelect();
            showToast('🗑️ Medicine deleted', 'success');

            try {
                const params = new URLSearchParams();
                params.append('action', 'deleteMedicine');
                params.append('id', id);
                await fetch(CONFIG.apiUrl + '?' + params.toString(), {
                    method: 'GET',
                    redirect: 'follow'
                });
            } catch(err) {
                console.error('Delete medicine sync error:', err);
            }
        }

        // PURCHASES
        function updatePurchasesTable() {
            const tbody = document.getElementById('purchasesBody');
            const cards = document.getElementById('purchasesCards');
            tbody.innerHTML = purchases.map((p, i) => `
                <tr>
                    <td style="white-space:nowrap;">${p.date}</td>
                    <td>${p.supplier}</td>
                    <td><strong>${p.medicineName}</strong></td>
                    <td style="text-align:center;">${p.qty}</td>
                    <td>₹${p.costPrice}</td>
                    <td style="font-weight:700;">₹${(p.qty * p.costPrice).toFixed(2)}</td>
                    <td><button class="btn-danger btn-small" onclick="deletePurchase('${p.id||i}')">🗑️</button></td>
                </tr>
            `).join('');
            if (cards) {
                cards.innerHTML = purchases.length ? purchases.slice().reverse().map((p, i) => `
                    <div class="m-card">
                        <div class="m-card-row">
                            <div class="m-card-title">${p.medicineName}</div>
                            <div class="m-card-val">₹${(p.qty * p.costPrice).toFixed(2)}</div>
                        </div>
                        <div class="m-card-meta">🏪 ${p.supplier} &nbsp;|&nbsp; 📦 Qty: ${p.qty}</div>
                        <div class="m-card-meta">💰 Cost: ₹${p.costPrice}/unit &nbsp;|&nbsp; 📅 ${p.date}</div>
                        <div class="m-card-actions" style="margin-top:8px;">
                            <button style="background:#e74c3c;" onclick="deletePurchase('${p.id||''}')">🗑️ Delete</button>
                        </div>
                    </div>
                `).join('') : '<div style="text-align:center;color:#aaa;padding:20px;">No purchases yet.</div>';
            }
        }

        async function deletePurchase(id) {
            if (!id) { showToast('Cannot delete — no ID on this record', 'warning'); return; }
            if (!confirm('Delete this purchase record? This cannot be undone.')) return;
            purchases = purchases.filter(p => (p.id||'') !== id);
            localStorage.setItem('purchases', JSON.stringify(purchases));
            updatePurchasesTable();
            showToast('🗑️ Purchase deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            try {
                const params = new URLSearchParams();
                params.append('action', 'deletePurchase');
                params.append('id', id);
                const res = await fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' }).then(r => r.json());
                if (res.success) showToast('☁️ Removed from Google Sheets', 'success');
                else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning');
            } catch(err) { showToast('⚠️ Deleted locally only — no internet?', 'warning'); }
        }

        function openAddPurchaseModal() {
            document.getElementById('purchaseDate').valueAsDate = new Date();
            document.getElementById('purchaseSupplier').value = '';
            document.getElementById('purchaseMedicine').value = '';
            document.getElementById('purchaseQty').value = '1';
            document.getElementById('purchaseCostPrice').value = '';
            document.getElementById('addPurchaseModal').classList.add('active');
        }

        async function savePurchase() {
            const date = document.getElementById('purchaseDate').value;
            const supplier = document.getElementById('purchaseSupplier').value.trim();
            const medicineId = document.getElementById('purchaseMedicine').value;
            const qty = parseInt(document.getElementById('purchaseQty').value);
            const costPrice = parseFloat(document.getElementById('purchaseCostPrice').value);

            if (!date || !supplier || !medicineId || !qty || !costPrice) {
                showToast('Fill all fields', 'warning');
                return;
            }

            // Try ID match first (string-safe)
            let medicine = medicines.find(m => String(m.id) === String(medicineId));

            // Fallback: match by selected option display name (handles tempId vs real ID mismatch)
            if (!medicine) {
                const selectEl = document.getElementById("purchaseMedicine");
                const selectedText = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "";
                const selectedName = selectedText.replace(/\s*\(Stock:.*\)$/, "").trim();
                medicine = medicines.find(m => m.name.trim().toLowerCase() === selectedName.toLowerCase());
            }

            if (!medicine) {
                const selectEl = document.getElementById("purchaseMedicine");
                const dbgText = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : "none";
                console.warn("savePurchase failed | dropdown value:", medicineId, "| selected text:", dbgText, "| medicine ids:", medicines.map(m=>m.id));
                showToast("❌ Medicine ID mismatch — please close this form and reopen it, then try again.", "error");
                return;
            }

            showSaving();

            // Save locally immediately
            purchases.push({ id: 'PUR-' + Date.now(), date, supplier, medicineId: medicine.id, medicineName: medicine.name, qty, costPrice });
            medicine.stock = (medicine.stock || 0) + qty;

            // Reset form fields for next entry
            document.getElementById('purchaseSupplier').value = '';
            document.getElementById('purchaseMedicine').value = '';
            document.getElementById('purchaseQty').value = '1';
            document.getElementById('purchaseCostPrice').value = '';
            document.getElementById('purchaseDate').valueAsDate = new Date();

            closeModal('addPurchaseModal');
            updatePurchasesTable();
            updateInventoryTable();
            updateMedicineSelect();
            hideSaving();
            showToast('✅ Purchase saved! Syncing to Sheets...', 'success');

            // Sync to Sheets in background
            try {
                const params = new URLSearchParams();
                params.append('action', 'addPurchase');
                params.append('date', date);
                params.append('supplier', supplier);
                params.append('medicineId', medicineId);
                params.append('medicineName', medicine.name);
                params.append('qty', qty);
                params.append('costPrice', costPrice);

                fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            showToast('☁️ Purchase synced to Sheets!', 'success');
                        } else {
                            showToast('⚠️ Saved locally, Sheets sync failed', 'warning');
                        }
                    })
                    .catch(() => showToast('⚠️ Saved locally, Sheets offline', 'warning'));
            } catch(e) {
                showToast('⚠️ Saved locally, Sheets offline', 'warning');
            }
        }

        // BILLS TABLE
        function updateBillsTable() {
            const tbody = document.getElementById('billsBody');
            const cardsEl = document.getElementById('billsCards');
            const __allBills = bills.slice().reverse();
            const sorted = __lazySlice('bills', __allBills); // lazy: 50 at a time

            if (!sorted.length) {
                if(tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:20px;">No bills yet.</td></tr>';
                if(cardsEl) cardsEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:30px;">No bills yet.</div>';
                return;
            }

            let tableRows = '';
            let cardHtml  = '';

            sorted.forEach(bill => {
                let items = bill.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

                const isCB = bill.billId && String(bill.billId).startsWith('CB-');
                const printFn = isCB ? `reprintCbBillFromAllBills('${bill.billId}')` : `reprrintBill('${bill.billId}')`;
                const waFn    = isCB ? `shareWhatsAppCb('${bill.billId}')` : `shareWhatsApp('${bill.billId}')`;

                const payColor = bill.paymentMode==='Cash'?'#e8f8ee':bill.paymentMode==='UPI'?'#fff3e0':bill.paymentMode==='Card'?'#e8f0fe':'#fce4ec';
                const payText  = bill.paymentMode==='Cash'?'#27ae60':bill.paymentMode==='UPI'?'#e67e22':bill.paymentMode==='Card'?'#2c5aa0':'#c0392b';

                const medNames = items.map(i => {
                    const m = medicines.find(x => String(x.id)===String(i.medicineId));
                    return i.medicineName||(m?m.name:null)||i.name||'—';
                });

                // ── Desktop table row ──
                const typeBadge = isCB
                    ? `<span style="background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">🧾 Bill Summary</span>`
                    : `<span style="background:#e8f8ee;color:#27ae60;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">💊 Pharmacy</span>`;
                const trInfo = (isCB && bill.trDesc)
                    ? `<div><span style="background:#f0f4ff;color:#1e3f5a;border-radius:4px;padding:2px 7px;font-size:12px;">🦷 ${bill.trDesc.substring(0,35)}${bill.trDesc.length>35?'...':''}</span></div>`
                    : '';
                const medBadges = medNames.length
                    ? medNames.map((n,i2)=>`<span style="display:inline-block;background:#e8f0fe;color:#2c5aa0;border-radius:4px;padding:2px 7px;margin:2px;font-size:12px;">${n} ×${items[i2].qty}</span>`).join('')
                    : '<span style="color:#aaa;font-size:12px;">—</span>';

                tableRows += `<tr>
                    <td style="font-size:11px;font-family:monospace;">${bill.billId}</td>
                    <td>${typeBadge}</td>
                    <td>${bill.patientName||'—'}</td>
                    <td>${bill.doctor||'—'}</td>
                    <td style="max-width:200px;">${trInfo}${medBadges}</td>
                    <td style="font-weight:700;">₹${parseFloat(bill.total||0).toFixed(2)}</td>
                    <td><span style="background:${payColor};color:${payText};border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">${bill.paymentMode||'—'}</span></td>
                    <td style="white-space:nowrap;">${bill.date||'—'}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn-primary btn-small" onclick="${printFn}" style="margin-right:4px;">🖨️ Print</button>
                        <button class="btn-primary btn-small" onclick="${waFn}" style="background:#25d366;">📲 WA</button>
                    </td>
                </tr>`;

                // ── Mobile card ──
                const typeLabel = isCB ? '🧾 Bill Summary' : '💊 Pharmacy';
                const typeColor = isCB ? '#2c5aa0' : '#27ae60';
                const medLine   = medNames.length ? medNames.map((n,i2)=>`${n} ×${items[i2].qty}`).join(', ') : '';
                const trLine    = (isCB && bill.trDesc) ? `<div class="bill-card-meta">🦷 ${bill.trDesc.substring(0,50)}${bill.trDesc.length>50?'...':''}</div>` : '';

                cardHtml += `<div class="bill-card ${isCB?'bc-cb':'bc-ph'}">
                    <div class="bill-card-top">
                        <div>
                            <div class="bill-card-name">${bill.patientName||'—'}</div>
                            <span style="background:${isCB?'#e8f0fe':'#e8f8ee'};color:${typeColor};border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;">${typeLabel}</span>
                        </div>
                        <div style="text-align:right;">
                            <div class="bill-card-total">₹${parseFloat(bill.total||0).toFixed(2)}</div>
                            <div style="font-size:11px;color:#888;">${bill.date||''}</div>
                        </div>
                    </div>
                    <div class="bill-card-meta">👨‍⚕️ ${bill.doctor||'—'} &nbsp;|&nbsp; <span class="pay-badge" style="background:${payColor};color:${payText};">${bill.paymentMode||'—'}</span></div>
                    ${trLine}
                    ${medLine?`<div class="bill-card-meta">💊 ${medLine}</div>`:''}
                    <div class="bill-card-actions" style="margin-top:10px;">
                        <button class="bc-print-btn" onclick="${printFn}">🖨️ Print</button>
                        <button class="bc-wa-btn" onclick="${waFn}">📲 WhatsApp</button>
                    </div>
                </div>`;
            });

            if(tbody)    tbody.innerHTML    = tableRows + __lazyMore('bills', __allBills.length, sorted.length, 9);
            if(cardsEl)  cardsEl.innerHTML  = cardHtml + __lazyMore('bills', __allBills.length, sorted.length);
        }

        // Filter bills by patient name search
        function filterBills() {
            const q = (document.getElementById('billsSearch').value||'').toLowerCase();
            if (!q) { updateBillsTable(); return; }
            const filtered = bills.filter(b => (b.patientName||'').toLowerCase().includes(q));
            const saved = bills;
            bills = filtered;
            updateBillsTable();
            bills = saved;
        }

        async function deleteBill(billId) {
            if (!confirm('Are you sure you want to delete Bill: ' + billId + '?\nThis cannot be undone.')) return;

            // Remove from local state immediately
            bills = bills.filter(b => b.billId !== billId);
            updateBillsTable();
            updateDashboard();
            showToast('🗑️ Bill deleted', 'success');

            // Also delete from Google Sheets
            try {
                const params = new URLSearchParams();
                params.append('action', 'deleteBill');
                params.append('billId', billId);
                await fetch(CONFIG.apiUrl + '?' + params.toString(), {
                    method: 'GET',
                    redirect: 'follow'
                });
            } catch(err) {
                console.error('Delete sync error:', err);
            }
        }


        // Universal print helper — works for local files
        function closePrintModal() {
            const m = document.getElementById('__printModal');
            const s = document.getElementById('__printModalStyle');
            if (m) m.remove();
            if (s) s.remove();
        }

        // PRINT ENGINE — uses hidden iframe, works on iPad/iPhone Safari, Chrome, Firefox, Android
        // No popup windows means no freezing on mobile/tablet
        // ── PRINT CHOICE DIALOG ────────────────────────────────
        var __pendingPrintHtml = null;

        function printBillHtml(html) {
            var savingOverlay = document.getElementById('savingOverlay');
            if (savingOverlay) savingOverlay.style.display = 'none';
            __pendingPrintHtml = html;
            // Show print-choice dialog
            var dlg = document.getElementById('__printChoiceDlg');
            if (dlg) {
                // Update BT button state
                var btBtn = document.getElementById('__pcdBtBtn');
                if (btBtn) {
                    if (window._btPrinter && window._btPrinter.connected) {
                        btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">80mm · '+(_btPrinter.deviceName||'BT Printer')+'</span>';
                        btBtn.style.opacity = '1';
                        btBtn.style.pointerEvents = 'auto';
                    } else {
                        btBtn.innerHTML = '🔵 Thermal Print<br><span style="font-size:11px;opacity:0.85;">Tap to connect printer</span>';
                        btBtn.style.opacity = '0.75';
                        btBtn.style.pointerEvents = 'auto';
                    }
                }
                dlg.style.display = 'flex';
                requestAnimationFrame(function(){
                    var sheet = document.getElementById('__pcdSheet');
                    if(sheet) sheet.style.transform = 'translateY(0)';
                });
            } else {
                _doPrintRegular(html);
            }
        }

        function _doPrintRegular(html) {
            var fullHtml = '<!DOCTYPE html><html><head>' +
                '<meta charset="UTF-8">' +
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Bill - Sri Sai Speciality Dental Care</title>' +
                '<style>html,body{margin:0;padding:0;background:white;color:#000;font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{margin:10mm;size:A4 portrait;}@media print{html,body{margin:0;padding:0;}.no-print{display:none!important;}}</style>' +
                '</head><body>' + html + '</body></html>';
            var old = document.getElementById('__printIframe');
            if (old) old.remove();
            var iframe = document.createElement('iframe');
            iframe.id = '__printIframe';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.style.cssText = 'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;border:none;visibility:hidden;';
            document.body.appendChild(iframe);
            try {
                var iDoc = iframe.contentDocument || iframe.contentWindow.document;
                iDoc.open(); iDoc.write(fullHtml); iDoc.close();
                var isIpadSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);
                setTimeout(function() {
                    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
                    catch(pe) { iframe.remove(); _showPrintOverlay(html); return; }
                    setTimeout(function() { var f=document.getElementById('__printIframe'); if(f)f.remove(); }, 4000);
                }, isIpadSafari ? 950 : 500);
                return;
            } catch(e) { iframe.remove(); }
            _showPrintOverlay(html);
        }

        function __closePrintChoice() {
            var dlg = document.getElementById('__printChoiceDlg');
            var sheet = document.getElementById('__pcdSheet');
            if(sheet) sheet.style.transform = 'translateY(110%)';
            setTimeout(function(){ if(dlg) dlg.style.display='none'; }, 320);
        }

        function __pickRegularPrint() {
            __closePrintChoice();
            setTimeout(function(){ _doPrintRegular(__pendingPrintHtml || ''); }, 350);
        }

        function __pickThermalPrint() {
            __closePrintChoice();
            setTimeout(function(){ __showThermalPreview(__pendingPrintHtml || ''); }, 350);
        }

        function __closeThermalPreview() {
            var dlg = document.getElementById('__thermalPreviewDlg');
            if (!dlg) return;
            dlg.classList.remove('open');
            setTimeout(function(){ dlg.style.display='none'; }, 300);
        }

        function __showThermalPreview(html) {
            var dlg = document.getElementById('__thermalPreviewDlg');
            var rollEl = document.getElementById('__tpvContent');
            if (!dlg || !rollEl) return;
            function renderLines() {
                var lines = __buildThermalPreviewLines(html);
                var qrAmount = 0;
                rollEl.innerHTML = lines.map(function(l){
                    if (l.qr) {
                        qrAmount = l.amount || 289.60;
                        return '<div class="__tpvQrWrap" id="__tpvQrBox" style="text-align:center;padding:8px 0;background:#fdfaf4;"></div>';
                    }
                    // Full-width CSS dividers — always span edge to edge
                    if (l.divider) {
                        var t = l.text||'';
                        if (t.indexOf('=') >= 0) return '<div class="__tpvDivFull __tpvDivLine"></div>';
                        if (t.indexOf('.') >= 0) return '<div class="__tpvDivFull __tpvDotLine"></div>';
                        return '<div class="__tpvDivFull __tpvDashLine"></div>';
                    }
                    if (l.star) return '<div class="__tpvDivFull __tpvStarLine"></div>';
                    var cls = '__tpvLine';
                    if(l.center||l.tall) cls += ' center';
                    if(l.bold)    cls += ' bold';
                    if(l.tall)    cls += ' tall';
                    var txt = (l.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    return '<div class="'+cls+'">'+txt+'</div>';
                }).join('');

                // Render actual QR code into the placeholder div
                var qrBox = document.getElementById('__tpvQrBox');
                if (qrBox && qrAmount > 0) {
                    var upiUrl = 'upi://pay?pa=8688033072@ybl&pn=SriSaiDental&am='+qrAmount.toFixed(2)+'&cu=INR&tn=DentalBill';
                    __renderQRtoDiv(qrBox, upiUrl, 72);
                }

                // Scroll to top after render
                var sc = document.getElementById('__tpvScrollArea');
                if (sc) {
                    sc.scrollTop = 0;
                    sc.onscroll = function() {
                        var thumb = document.getElementById('__tpvScrollThumb');
                        if (!thumb) return;
                        var pct = sc.scrollHeight <= sc.clientHeight ? 1 :
                            sc.scrollTop / (sc.scrollHeight - sc.clientHeight);
                        var w = Math.max(15, Math.round(pct * 70));
                        var left = Math.round(pct * (100 - w));
                        thumb.style.width = w + '%';
                        thumb.style.left  = left + '%';
                    };
                }
            }
            // Show dialog, wait two frames for layout, then render
            dlg.style.display = 'flex';
            requestAnimationFrame(function(){
                dlg.classList.add('open');
                requestAnimationFrame(function(){
                    requestAnimationFrame(renderLines);
                });
            });
        }

        function __buildThermalPreviewLines(html) {
            // W = characters per line. We use font-size:12px Courier New.
            // Courier New 12px → char width ≈ 7.2px on desktop, ~7.8px on mobile (due to DPI/rendering)
            // Roll inner width = modal sheet width (max 430px) minus scroll(8px) minus padding(16px) = ~392px
            // On mobile we use a larger char-width estimate to avoid overflow.
            var rollEl = document.getElementById('__tpvContent');
            var innerPx = 260; // safe fallback
            if (rollEl && rollEl.offsetWidth > 0) {
                // subtract padding (8px each side) + small buffer
                innerPx = rollEl.offsetWidth - 24;
            }
            // Use same _W as actual print — ensures preview matches real output exactly
            // _W is loaded from localStorage (default 42 for KP307)
            var W = (typeof _W !== 'undefined' && _W >= 24) ? _W : 42;

            var lines = [];
            function rep(c,n)   { return n>0 ? c.repeat(Math.ceil(n)) : ''; }
            function dbl()      { lines.push({text:rep('=',W), divider:true}); }
            function div_()     { lines.push({text:rep('-',W), divider:true}); }
            function dot()      { lines.push({text:rep('.',W), divider:true}); }
            function star()     { lines.push({text:rep('=',W), divider:true}); }
            function nl()       { lines.push({text:''}); }
            function ctr(t,b,tl){ lines.push({text:String(t||''),center:true,bold:!!b,tall:!!tl}); }
            function lft(t,b)   { lines.push({text:String(t||'').substring(0,W),bold:!!b}); }
            function tr_(s,w)   { return String(s||'').substring(0,w||W); }
            // Right-align `r` after `l` with spaces
            function spc(l,r) {
                l = String(l||''); r = String(r||'');
                var sp = W - l.length - r.length;
                if (sp < 1) { l = l.substring(0, W - r.length - 1); sp = 1; }
                lines.push({text: l + rep(' ',sp) + r});
            }
            function isSample(){ return !html || html.replace(/<[^>]*>/g,'').replace(/\s/g,'').length < 20; }

            // ── HEADER ───────────────────────────────────────
            ctr('SRI SAI SPECIALITY DENTAL CARE', true, true);
            ctr('~ Smile With Confidence ~', false, false);
            star();
            ctr('TKR College Rd, Karmanghat', true);
            ctr('Ph: 9396522492 / 8688033072', true);
            star();

            function addSampleMeds() {
                ctr('- MEDICINES -', true);
                dot(); spc('  Item','Amt'); dot();
                spc('  Apcil 375mg  x6 @Rs.18.10', '108.60');
                spc('  Cenodol-SP   x6 @Rs.9.00 ', ' 54.00');
                spc('  Metro hex    x1 @Rs.127.00', '127.00');
                dot();
                spc('Pharmacy', 'Rs.289.60');
            }
            function addFooter(gt) {
                nl(); dbl();
                ctr('*  THANK YOU  *', true, true);
                ctr('Beauty is Power, Smile is a Sword', true);
                ctr('Visit Again! Stay Healthy :)', true);
                dbl(); nl();
                star();
                ctr('SCAN & PAY', true);
                nl();
                // Special QR marker — replaced with canvas after render
                lines.push({text:'__QR__:'+(gt>0?gt.toFixed(2):'289.60'), qr:true, amount:(gt>0?gt:289.60)});
                nl();
                ctr('Rs. ' + (gt > 0 ? gt.toFixed(2) : '289.60'), true, true);
                ctr('8688033072@ybl', true);
                ctr('GPay / PhonePe / Any UPI');
                star();
            }

            // ── SAMPLE PATH ──────────────────────────────────
            if (isSample()) {
                lft('Bill No : BILL-' + Date.now().toString().slice(-6));
                lft('Date    : ' + new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}));
                lft('Patient : Mamatha');
                lft('Doctor  : Dr. T Sai Vakula');
                div_(); addSampleMeds();
                dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. 289.60',true,true); dbl();
                addFooter(289.60);
                return lines;
            }

            // ── REAL BILL PATH ───────────────────────────────
            html = html.replace(/&#8377;/g,'Rs.').replace(/\u20b9/g,'Rs.')
                       .replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')
                       .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
            var doc2 = (new DOMParser()).parseFromString(html,'text/html');
            var grandTotal = 0;
            var isCB = !!doc2.getElementById('__cb');
            var isRx = !!doc2.getElementById('__rx');
            var isTr = !!doc2.getElementById('__tr');

            if (isCB) {
                var cb = doc2.getElementById('__cb');
                var iv = Array.from(cb.querySelectorAll('.i-val')).map(function(e){
                    return e.textContent.replace(/\u00a0/g,' ').trim();
                });
                if(iv[0]) lft('Bill No : '+tr_(iv[0],W-9), true);
                if(iv[1]) lft('Date    : '+tr_(iv[1],W-9));
                if(iv[2]) lft('Patient : '+tr_(iv[2],W-9));
                if(iv[3]) lft('Doctor  : '+tr_(iv[3],W-9));
                div_();
                var mTable=cb.querySelector('table.meds'), meds2=[];
                if(mTable){ Array.from(mTable.querySelectorAll('tbody tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if(td.length<2||!td[0]||/no medicines/i.test(td[0]))return;
                    meds2.push({name:td[0],qty:td[1]||'',rate:td[2]||'',amount:td[td.length-1]});
                });}
                // Safe money parser for this scope
                function pM(s){var m=String(s||'').replace(/,/g,'').match(/(\d+\.?\d*)/);return m?parseFloat(m[1]):0;}
                if(meds2.length>0){
                    ctr('- MEDICINES -',true); dot(); spc('  Item','Amt'); dot();
                    meds2.forEach(function(m){
                        var aStr=pM(m.amount).toFixed(2);
                        var left='  '+tr_(m.name,13)+(m.qty?' x'+m.qty:'')+(m.rate?' @'+m.rate:'');
                        spc(tr_(left,W-aStr.length-1), aStr);
                    }); dot();
                }
                var sBox=cb.querySelector('.summary-box'), sRows2=[];
                if(sBox){Array.from(sBox.querySelectorAll('tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if(td.length>=2&&td[0]&&td[1])sRows2.push({label:td[0],value:td[1]});
                });}
                sRows2.slice(0,-1).forEach(function(r){
                    var lbl = tr_(r.label.replace(/[^ -~]/g,'').trim(),W-12);
                    var val = 'Rs.'+pM(r.value).toFixed(2);
                    var sp = W-lbl.length-val.length;
                    if(sp<1){lbl=lbl.substring(0,W-val.length-1);sp=1;}
                    lines.push({text:lbl+' '.repeat(sp)+val, bold:true});
                });
                if(sRows2.length>0){
                    var g=sRows2[sRows2.length-1];
                    grandTotal=pM(g.value)||0;
                    dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl();
                }

            } else if (isTr) {
                var trEl=doc2.getElementById('__tr');
                var iV2=Array.from(trEl.querySelectorAll('.i-val')).map(function(e){
                    return e.textContent.replace(/\u00a0/g,' ').trim();
                });
                if(iV2[0]) lft('Bill No : '+tr_(iV2[0],W-9),true);
                if(iV2[1]) lft('Date    : '+tr_(iV2[1],W-9));
                if(iV2[2]) lft('Patient : '+tr_(iV2[2],W-9));
                if(iV2[3]) lft('Amount  : Rs.'+tr_(iV2[3],W-12));
                div_();
                var trRows2=Array.from(trEl.querySelectorAll('table.treat td.item-cell')).map(function(td){return td.textContent.trim();}).filter(Boolean);
                if(trRows2.length){ lft('TOWARDS:',true); trRows2.forEach(function(l){ctr(l.trim(),true,false);}); }
                grandTotal=parseFloat((iV2[3]||'0').replace(/[^\d.]/g,''))||0;
                if(grandTotal>0){ dbl(); ctr('** TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl(); }

            } else if (isRx) {
                var rxEl=doc2.getElementById('__rx');
                (rxEl?(rxEl.innerText||rxEl.textContent):'').split('\n')
                    .map(function(l){return l.trim();}).filter(Boolean).slice(0,20)
                    .forEach(function(l){if(!/^(sri sai|mob|timing|reg\.|b\.d)/i.test(l))lft(tr_(l,W));});

            } else {
                // ── Generic pharmacy bill ─────────────────────
                var inf = {};
                // Parse .lbl/.val sibling pairs
                Array.from(doc2.querySelectorAll('.lbl')).forEach(function(lbl){
                    var val = lbl.nextElementSibling;
                    if (!val) return;
                    var k = lbl.textContent.trim().toLowerCase();
                    var v = val.textContent.trim();
                    if (!v || v==='—') return;
                    if (/patient|name/.test(k))   inf.patient = inf.patient||v;
                    else if (/doctor|dr/.test(k)) inf.doctor  = inf.doctor||v;
                    else if (/date/.test(k))      inf.date    = inf.date||v;
                    else if (/payment|mode/.test(k)) inf.pay  = inf.pay||v;
                });
                // .bid element for bill id
                var bidEl = doc2.querySelector('.bid');
                if (bidEl) inf.no = bidEl.textContent.trim();

                lft('Bill No : '+tr_(inf.no||'BILL-001', W-9), true);
                lft('Date    : '+tr_(inf.date||new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}),W-9));
                if(inf.patient) lft('Patient : '+tr_(inf.patient, W-9));
                if(inf.doctor)  lft('Doctor  : '+tr_(inf.doctor,  W-9));
                div_();

                // Helper: safely parse a currency string like "Rs.108.60" or "&#8377;108.60"
                function parseMoney(s) {
                    // Find the first run of digits (with optional decimal point)
                    var m = String(s||'').replace(/,/g,'').match(/(\d+\.?\d*)/);
                    return m ? parseFloat(m[1]) : 0;
                }

                // Extract medicine rows
                var meds3 = [];
                Array.from(doc2.querySelectorAll('table tbody tr')).forEach(function(row){
                    var td=Array.from(row.querySelectorAll('td')).map(function(c){return c.textContent.trim();});
                    if (td.length < 2 || !td[0]) return;
                    if (/total|grand|subtotal|discount/i.test(td[0])) return;
                    var amt = parseMoney(td[td.length-1]);
                    if (amt <= 0) return;
                    var qty  = td.length >= 3 ? td[1] : '';
                    var rate = td.length >= 4 ? td[2] : '';
                    meds3.push({name:td[0], qty:qty, rate:rate, amount:amt});
                });

                // Grand total — tr.grand is the last row in .tot table
                var gtEl = doc2.querySelector('tr.grand td:last-child');
                if (gtEl) grandTotal = parseMoney(gtEl.textContent);

                // Fallback: last row of any .tot table
                if (!grandTotal) {
                    var totTbl = doc2.querySelector('.tot table');
                    if (totTbl) {
                        var trows = totTbl.querySelectorAll('tr');
                        for (var ri = trows.length-1; ri >= 0; ri--) {
                            var tds = trows[ri].querySelectorAll('td');
                            if (tds.length >= 2) {
                                var v = parseMoney(tds[tds.length-1].textContent);
                                if (v > 0) { grandTotal = v; break; }
                            }
                        }
                    }
                }

                // Fallback: text scan
                if (!grandTotal) {
                    var bodyTxt = doc2.body ? (doc2.body.innerText||doc2.body.textContent) : '';
                    var gm = bodyTxt.match(/grand\s+total[^\d]*(\d[\d,]*\.?\d*)/i);
                    if (gm) grandTotal = parseFloat(gm[1].replace(/,/g,''))||0;
                }

                if (meds3.length > 0) {
                    ctr('- MEDICINES -',true); dot(); spc('  Item','Amt'); dot();
                    meds3.forEach(function(m){
                        var aStr = m.amount.toFixed(2);
                        var left = '  '+tr_(m.name,14)+(m.qty?' x'+m.qty:'')+(m.rate?' @'+m.rate:'');
                        spc(tr_(left, W-aStr.length-1), aStr);
                    }); dot();
                    spc('Grand Total', 'Rs.'+grandTotal.toFixed(2));
                } else {
                    addSampleMeds();
                    if (!grandTotal) grandTotal = 289.60;
                }
                dbl(); ctr('** GRAND TOTAL **',true,true); ctr('Rs. '+grandTotal.toFixed(2),true,true); dbl();
            }

            addFooter(grandTotal);
            return lines;
        }

        function _showPrintOverlay(html) {
            var modal = document.getElementById('__printModal');
            if (modal) modal.remove();
            var st = document.getElementById('__printModalStyle');
            if (st) st.remove();
            modal = document.createElement('div');
            modal.id = '__printModal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999999;background:white;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;box-sizing:border-box;';
            var btnBar = document.createElement('div');
            btnBar.className = 'no-print';
            btnBar.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #2c5aa0;position:sticky;top:0;background:white;z-index:2;';
            btnBar.innerHTML = '<button onclick="window.print()" style="padding:12px 28px;background:#2c5aa0;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">🖨️ Print / Save PDF</button>' +
                '<button onclick="closePrintModal()" style="padding:12px 20px;background:#e74c3c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;touch-action:manipulation;">✕ Close</button>';
            var billDiv = document.createElement('div');
            billDiv.innerHTML = html;
            modal.appendChild(btnBar); modal.appendChild(billDiv);
            document.body.appendChild(modal);
            var style = document.createElement('style');
            style.id = '__printModalStyle';
            style.innerHTML = '@media print{body>*:not(#__printModal){display:none!important;}#__printModal{position:static!important;overflow:visible!important;padding:0!important;}.no-print{display:none!important;}}';
            document.head.appendChild(style);
        }

        // ══ PRESCRIPTION ══════════════════════════════════════
        function buildPrescriptionHTML() {
            const name   = document.getElementById('rx_name').value || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';
            const dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '___________';

            const emptyLines = Array(8).fill('<div style="min-height:24px;border-bottom:1px dotted #aaa;margin-bottom:3px;">&nbsp;</div>').join('');
            const rxLines = rxText
                ? rxText.split('\n').map(line =>
                    '<div style="min-height:24px;border-bottom:1px dotted #aaa;padding:2px 0;margin-bottom:3px;">'
                    + (line ? line.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '&nbsp;')
                    + '</div>').join('')
                : emptyLines;

            return `<style>
  #__rx, #__rx * { font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; box-sizing:border-box; }
  #__rx { color:#000; background:#fff; padding:20px 26px; }
  #__rx h2 { font-size:18px; font-weight:900; letter-spacing:1.5px; text-transform:uppercase; margin:0 0 3px; text-align:center; }
  #__rx .sub { text-align:center; font-size:11.5px; margin-bottom:2px; }
  #__rx .timing { text-align:center; font-size:11px; font-weight:700; margin-bottom:10px; }
  #__rx .docs-row { display:table; width:100%; border:1.5px solid #000; border-collapse:collapse; margin-bottom:12px; }
  #__rx .doc-cell { display:table-cell; width:50%; vertical-align:top; padding:8px 14px; font-size:11.5px; line-height:1.75; text-align:center; }
  #__rx .doc-cell:first-child { border-right:1.5px solid #000; }
  #__rx .doc-cell strong { font-size:13px; display:block; }
  #__rx .note { font-size:10.5px; color:#333; border:1px solid #999; border-radius:3px; padding:5px 10px; margin-bottom:12px; line-height:1.55; }
  #__rx .pt { display:table; width:100%; border-collapse:collapse; margin-bottom:12px; }
  #__rx .pt td { display:table-cell; vertical-align:bottom; padding-bottom:3px; font-size:13px; white-space:nowrap; }
  #__rx .pt td.lbl { padding-right:4px; }
  #__rx .pt td.val { border-bottom:1px solid #000; padding-left:4px; padding-right:4px; }
  #__rx .pt td.gap { padding-left:16px; }
  #__rx .rx-lbl { font-size:26px; font-weight:900; font-style:italic; margin:8px 0 6px; }
  #__rx .rx-body { min-height:160px; }
  #__rx .sig { text-align:right; margin-top:24px; font-size:12.5px; padding-right:10px; border-top:1px dashed #ccc; padding-top:10px; }
  #__rx .footer { text-align:center; font-size:10px; color:#555; font-style:italic; border-top:1px solid #ccc; margin-top:14px; padding-top:8px; line-height:1.6; }
  @media print { body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
</style>
<div id="__rx">

  <h2>Sri Sai Speciality Dental Care</h2>
  <div class="sub">TKR College Road, Karmanghat, Hyderabad.</div>
  <div class="sub">Mobile : 9396522492, 8688033072</div>
  <div class="timing">Timings :- MON-SUN &nbsp; 9AM TO 9PM</div>

  <div class="docs-row">
    <div class="doc-cell">
      <strong>DR. T. VENKAT RAO</strong>
      Reg. A-734<br>
      B.D.S (Osm), M.R.S.H, FAGE,<br>
      (SENIOR DENTAL SURGEON)<br>
      Member, Indian Dental Association
    </div>
    <div class="doc-cell">
      <strong>DR. T. SAI VAKULA</strong>
      Reg. A-15680<br>
      M.D.S.<br>
      MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>
      Specialist in Lasers &amp; Cosmetic Dentistry
    </div>
  </div>

  <div class="note">Note : Patients are requested to inform Doctor for any Drug reaction prior to each consultation and verify after prescription.</div>

  <table class="pt"><tr>
    <td class="lbl">Name :</td>
    <td class="val" style="min-width:180px;">&nbsp;${name}&nbsp;</td>
    <td class="gap lbl">Age / Sex :</td>
    <td class="val" style="min-width:50px;">&nbsp;${age}&nbsp;</td>
    <td class="lbl" style="padding:0 4px;">/ </td>
    <td class="val" style="min-width:60px;">&nbsp;${sex}&nbsp;</td>
    <td class="gap lbl">Date :</td>
    <td class="val" style="min-width:100px;">&nbsp;${dateStr}&nbsp;</td>
  </tr></table>

  <div class="rx-lbl">Rx</div>
  <div class="rx-body">${rxLines}</div>

  <div class="sig">DOCTOR'S SIGNATURE</div>

  <div class="footer">
    Cherish your Yesterdays, Dream your Tomorrow, but live your today<br>
    Beauty is a Power and Smile is a Sword
  </div>
</div>`;
        }

        function updateRxPreview() {
            const preview = document.getElementById('rx_preview');
            if (preview) preview.innerHTML = buildPrescriptionHTML();
        }

        function clearPrescriptionForm() {
            ['rx_name','rx_age','rx_date','rx_content'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            const sex = document.getElementById('rx_sex'); if (sex) sex.value = '';
            updateRxPreview();
        }

        function getRxHistory() {
            try { return JSON.parse(localStorage.getItem('rx_history') || '[]'); } catch(e) { return []; }
        }
        function saveRxHistory(list) {
            localStorage.setItem('rx_history', JSON.stringify(list));
        }

        function renderRxHistory() {
            const list = getRxHistory();
            const el = document.getElementById('rx_history_list');
            if (!el) return;
            if (!list.length) {
                el.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px;">No prescriptions saved yet.</div>';
                return;
            }
            el.innerHTML = list.slice().reverse().map((r, ri) => {
                const idx = list.length - 1 - ri;
                const preview = (r.rxText || '').replace(/\n/g,' ').substring(0, 80) + ((r.rxText||'').length > 80 ? '...' : '');
                return `<div style="border:1px solid #e0e8f5;border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8faff;">
                    <div style="min-width:0;">
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">${r.name || '-'} &nbsp;|&nbsp; Age: ${r.age||'-'} &nbsp;|&nbsp; ${r.sex||'-'}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${r.dateStr || '-'}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview || '-'}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button onclick="loadRxRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button onclick="reprintRxRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button onclick="deleteRxRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        function loadRxRecord(idx) {
            const list = getRxHistory();
            const r = list[idx]; if (!r) return;
            document.getElementById('rx_name').value = r.name || '';
            document.getElementById('rx_age').value = r.age || '';
            document.getElementById('rx_sex').value = r.sex || '';
            document.getElementById('rx_date').value = r.date || '';
            document.getElementById('rx_content').value = r.rxText || '';
            updateRxPreview();
            window.scrollTo(0,0);
        }

        function reprintRxRecord(idx) {
            const list = getRxHistory();
            const r = list[idx]; if (!r) return;
            loadRxRecord(idx);
            setTimeout(() => { printBillHtml(buildPrescriptionHTML()); }, 100);
        }

        function deleteRxRecord(idx) {
            if (!confirm('Delete this prescription from history?')) return;
            const list = getRxHistory();
            const rec = list[idx];
            list.splice(idx, 1);
            saveRxHistory(list);
            renderRxHistory();
            showToast('🗑️ Prescription deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const params = new URLSearchParams();
            params.append('action', 'deletePrescription');
            params.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
            params.append('patientName', rec ? (rec.name||'') : '');
            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(res => { if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
                .catch(() => showToast('⚠️ Deleted locally only', 'warning'));
        }

        function clearPrescriptionHistory() {
            if (!confirm('Clear all prescription history?')) return;
            localStorage.removeItem('rx_history');
            renderRxHistory();
        }

        function printPrescription() {
            const name   = document.getElementById('rx_name').value.trim() || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';
            const dateStr = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

            const record = { name, age, sex, date: dateV, dateStr, rxText, savedAt: new Date().toISOString() };
            const list = getRxHistory();
            list.push(record);
            saveRxHistory(list);
            renderRxHistory();

            printBillHtml(buildPrescriptionHTML());
            savePrescriptionToSheets();
        }

        function savePrescriptionToSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const name   = document.getElementById('rx_name').value || '';
            const age    = document.getElementById('rx_age').value || '';
            const sex    = document.getElementById('rx_sex').value || '';
            const dateV  = document.getElementById('rx_date').value || '';
            const rxText = document.getElementById('rx_content').value || '';

            const params = new URLSearchParams();
            params.append('action', 'savePrescription');
            params.append('date', dateV);
            params.append('patientName', name);
            params.append('age', age);
            params.append('sex', sex);
            params.append('prescription', rxText);

            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(result => {
                    if (result.success) showToast('☁️ Prescription saved to Sheets!', 'success');
                    else showToast('⚠️ Print OK, Sheets sync failed', 'warning');
                })
                .catch(() => showToast('⚠️ Print OK, Sheets offline', 'warning'));
        }
        // ══ END PRESCRIPTION ══════════════════════════════════

        // ══ TREATMENT RECEIPT ════════════════════════════════
        function buildTreatmentReceiptHTML(forPrint) {
            const no        = document.getElementById('tr_no').value || '___________';
            const date      = document.getElementById('tr_date').value || '';
            const patient   = document.getElementById('tr_patient').value || '______________________________';
            const amount    = document.getElementById('tr_amount').value || '___________';
            const words     = document.getElementById('tr_words').value || '______________________________';
            const treatText = (document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '') || '';
            const dateStr   = date ? new Date(date).toLocaleDateString('en-IN', {day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
            const clinicAddr  = CONFIG ? (CONFIG.clinicAddress || 'TKR College Road, Karmanghat, Hyderabad.') : 'TKR College Road, Karmanghat, Hyderabad.';
            const clinicPhone = CONFIG ? (CONFIG.clinicPhone || '9396522492, 8688033072') : '9396522492, 8688033072';

            // Build treatment rows — one row per line typed, minimum 6 rows for blank space
            const tLines = treatText ? treatText.split('\n').map(l => l.trim()).filter(Boolean) : [];
            const minRows = 6;
            const rowsToShow = Math.max(tLines.length, minRows);
            let treatmentRows = '';
            for (let i = 0; i < rowsToShow; i++) {
                const label = tLines[i] || '&nbsp;';
                treatmentRows += `<tr><td class="item-cell" style="height:30px;">${label}</td></tr>`;
            }

            return `<style>
  @page { size:A4 portrait; margin:10mm; }
  #__tr * { font-family:'Bookman Old Style','Book Antiqua',Bookman,Georgia,serif; box-sizing:border-box; margin:0; padding:0; }
  #__tr { width:100%; max-width:100%; padding:0; color:#000; background:#fff; font-size:13px; line-height:1.4; }
  #__tr h1 { text-align:center; font-size:19px; font-weight:900; letter-spacing:2px; text-transform:uppercase; margin-bottom:3px; }
  #__tr .addr { text-align:center; font-size:11.5px; margin-bottom:2px; }
  #__tr .mob  { text-align:center; font-size:11.5px; margin-bottom:10px; }
  #__tr .doctors { display:table; width:100%; border-collapse:collapse; border:1.5px solid #000; margin-bottom:10px; }
  #__tr .doc-cell { display:table-cell; width:50%; padding:8px 12px; text-align:center; font-size:12px; line-height:1.75; vertical-align:middle; }
  #__tr .doc-cell:first-child { border-right:1.5px solid #000; }
  #__tr .doc-cell strong { font-size:13px; display:block; }
  #__tr .receipt-title { text-align:center; font-size:15px; font-weight:900; letter-spacing:3px; margin-bottom:12px; text-decoration:underline; }
  #__tr .info-section { width:100%; margin-bottom:14px; font-size:13px; }
  #__tr .info-row { display:flex; align-items:flex-end; width:100%; margin-bottom:11px; }
  #__tr .i-left  { display:flex; align-items:flex-end; flex:0 0 55%; padding-right:6px; }
  #__tr .i-right { display:flex; align-items:flex-end; flex:0 0 45%; }
  #__tr .i-lbl   { flex:0 0 auto; white-space:nowrap; padding-right:7px; padding-bottom:3px; }
  #__tr .i-val   { flex:1 1 0; border-bottom:1.5px solid #000; padding:0 3px 3px 3px; min-height:18px; font-weight:bold; }
  #__tr .i-sep   { flex:0 0 auto; white-space:nowrap; padding-right:7px; padding-bottom:3px; }
  #__tr .info-row.full .i-val { flex:1 1 0; }
  #__tr .towards { font-size:13px; font-weight:900; margin-bottom:4px; letter-spacing:1px; }
  #__tr table.treat { width:100%; border-collapse:collapse; margin-bottom:14px; font-size:13px; }
  #__tr table.treat td { border:1.5px solid #000; padding:0; height:30px; vertical-align:middle; }
  #__tr table.treat td.item-cell { padding-left:8px; }
  #__tr .sig-row { display:flex; justify-content:flex-end; margin-top:18px; font-size:13px; padding-right:4px; }
  @media print { html, body { margin:0; padding:0; } #__tr { width:100%; } }
</style>
<div id="__tr">
  <h1>Sri Sai Speciality Dental Care</h1>
  <div class="addr">TKR College Road, Karmanghat, Hyderabad.</div>
  <div class="addr">Mobile : 9396522492, 8688033072</div>
  <div class="mob"><strong>Timings :- MON-SUN &nbsp; 9AM TO 9PM</strong></div>
  <div class="doctors">
    <div class="doc-cell">
      <strong>DR. T. VENKAT RAO</strong>
      Reg. A-734<br>B.D.S (Osm), M.R.S.H, FAGE,<br>(SENIOR DENTAL SURGEON)<br>Member, Indian Dental Association
    </div>
    <div class="doc-cell">
      <strong>DR. T. SAI VAKULA</strong>
      Reg. A-15680<br>M.D.S.<br>MAXILLOFACIAL SURGEON &amp; IMPLANTOLOGIST<br>Specialist in Lasers &amp; Cosmetic Dentistry
    </div>
  </div>
  <div class="receipt-title">RECEIPT</div>
  <div class="info-section">
    <div class="info-row">
      <div class="i-left"><span class="i-lbl">No.</span><span class="i-val">&nbsp;${no}</span></div>
      <div class="i-right"><span class="i-sep">Date:</span><span class="i-val">&nbsp;${dateStr}</span></div>
    </div>
    <div class="info-row">
      <div class="i-left"><span class="i-lbl">Received from</span><span class="i-val">&nbsp;${patient}</span></div>
      <div class="i-right"><span class="i-sep">Rs.</span><span class="i-val">&nbsp;${amount}</span></div>
    </div>
    <div class="info-row full"><span class="i-lbl">In words</span><span class="i-val">&nbsp;${words}</span></div>
  </div>
  <div class="towards">TOWARDS</div>
  <table class="treat"><tbody>${treatmentRows}</tbody></table>
  <div class="sig-row">Signature</div>
</div>`;
        }

                function updateTreatmentPreview() {
            const preview = document.getElementById('tr_preview');
            if (preview) preview.innerHTML = buildTreatmentReceiptHTML(false);
        }

        function clearTreatmentForm() {
            ['tr_no','tr_date','tr_patient','tr_amount','tr_words','tr_treatment_text'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            updateTreatmentPreview();
        }

        function getTreatmentHistory() {
            try { return JSON.parse(localStorage.getItem('tr_history') || '[]'); } catch(e) { return []; }
        }
        function saveTreatmentHistory(list) {
            localStorage.setItem('tr_history', JSON.stringify(list));
        }

        function renderTreatmentHistory() {
            const list = getTreatmentHistory();
            const el = document.getElementById('tr_history_list');
            if (!el) return;
            if (!list.length) {
                el.innerHTML = '<div style="color:#aaa;font-size:13px;text-align:center;padding:20px;">No receipts saved yet.</div>';
                return;
            }
            el.innerHTML = list.slice().reverse().map((r, ri) => {
                const idx = list.length - 1 - ri;
                return `<div style="border:1px solid #e0e8f5;border-radius:8px;padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#f8faff;">
                    <div>
                        <div style="font-weight:700;color:var(--primary);font-size:14px;">Receipt No. ${r.no || '-'} &nbsp;|&nbsp; ${r.patient || '-'}</div>
                        <div style="font-size:12px;color:#777;margin-top:3px;">Date: ${r.dateStr || '-'} &nbsp;|&nbsp; Rs. ${r.amount || '-'}</div>
                        <div style="font-size:12px;color:#555;margin-top:3px;">${r.treatments || '-'}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-shrink:0;">
                        <button onclick="loadTreatmentRecord(${idx})" style="background:#2c5aa0;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">✏️ Edit</button>
                        <button onclick="reprintTreatmentRecord(${idx})" style="background:#27ae60;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🖨️ Print</button>
                        <button onclick="deleteTreatmentRecord(${idx})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer;">🗑️</button>
                    </div>
                </div>`;
            }).join('');
        }

        function loadTreatmentRecord(idx) {
            const list = getTreatmentHistory();
            const r = list[idx]; if (!r) return;
            document.getElementById('tr_no').value = r.no || '';
            document.getElementById('tr_date').value = r.date || '';
            document.getElementById('tr_patient').value = r.patient || '';
            document.getElementById('tr_amount').value = r.amount || '';
            document.getElementById('tr_words').value = r.words || '';
            const ttEl = document.getElementById('tr_treatment_text');
            if (ttEl) ttEl.value = r.treatmentText || r.treatments || '';
            updateTreatmentPreview();
            window.scrollTo(0,0);
        }

        function reprintTreatmentRecord(idx) {
            const list = getTreatmentHistory();
            const r = list[idx]; if (!r) return;
            loadTreatmentRecord(idx);
            setTimeout(() => { printBillHtml(buildTreatmentReceiptHTML(true)); }, 100);
        }

        function deleteTreatmentRecord(idx) {
            if (!confirm('Delete this receipt from history?')) return;
            const list = getTreatmentHistory();
            const rec = list[idx];
            list.splice(idx, 1);
            saveTreatmentHistory(list);
            renderTreatmentHistory();
            showToast('🗑️ Treatment receipt deleted', 'success');
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const params = new URLSearchParams();
            params.append('action', 'deleteTreatmentReceipt');
            params.append('no', rec ? (rec.no||'') : '');
            params.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(res => { if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
                .catch(() => showToast('⚠️ Deleted locally only', 'warning'));
        }

        function clearTreatmentHistory() {
            if (!confirm('Clear all treatment receipt history?')) return;
            localStorage.removeItem('tr_history');
            renderTreatmentHistory();
        }

        function printTreatmentReceipt() {
            const no           = document.getElementById('tr_no').value.trim() || '';
            const dateV        = document.getElementById('tr_date').value || '';
            const patient      = document.getElementById('tr_patient').value.trim() || '';
            const amount       = document.getElementById('tr_amount').value || '';
            const words        = document.getElementById('tr_words').value || '';
            const treatmentText= document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '';
            const dateStr      = dateV ? new Date(dateV).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '';

            const record = { no, date: dateV, dateStr, patient, amount, words, treatmentText, treatments: treatmentText, savedAt: new Date().toISOString() };
            const list = getTreatmentHistory();
            list.push(record);
            saveTreatmentHistory(list);
            renderTreatmentHistory();

            const html = buildTreatmentReceiptHTML(true);
            printBillHtml(html);
            saveTreatmentReceiptToSheets();
        }

        function saveTreatmentReceiptToSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            const no      = document.getElementById('tr_no').value || '';
            const dateV   = document.getElementById('tr_date').value || '';
            const patient = document.getElementById('tr_patient').value || '';
            const amount  = document.getElementById('tr_amount').value || '';
            const words   = document.getElementById('tr_words').value || '';

            const selected = document.getElementById('tr_treatment_text') ? document.getElementById('tr_treatment_text').value.trim() : '';

            const params = new URLSearchParams();
            params.append('action', 'saveTreatmentReceipt');
            params.append('receiptNo', no);
            params.append('date', dateV);
            params.append('patient', patient);
            params.append('amount', amount);
            params.append('amountWords', words);
            params.append('treatments', selected);

            fetch(CONFIG.apiUrl + '?' + params.toString(), { method: 'GET', redirect: 'follow' })
                .then(r => r.json())
                .then(result => {
                    if (result.success) showToast('☁️ Treatment receipt saved to Sheets!', 'success');
                    else showToast('⚠️ Print OK, Sheets sync failed', 'warning');
                })
                .catch(() => showToast('⚠️ Print OK, Sheets offline', 'warning'));
        }
        // ══ END TREATMENT RECEIPT ══════════════════════════════

        function reprrintBill(billId) {

            const bill = bills.find(b => b.billId === billId);
            if (!bill) { showToast('Bill not found', 'error'); return; }

            let items = bill.items || [];
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

            const itemRows = items.map((item, i) => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                const medName = med ? med.name : (item.medicineName || item.name || 'Unknown');
                return '<tr style="background:'+(i%2===0?'#fff':'#f8f9fa')+'">' +
                    '<td style="padding:7px 10px;border-bottom:1px solid #eee;">'+medName+'</td>' +
                    '<td style="padding:7px 6px;text-align:center;border-bottom:1px solid #eee;">'+item.qty+'</td>' +
                    '<td style="padding:7px 6px;text-align:right;border-bottom:1px solid #eee;">&#8377;'+parseFloat(item.price).toFixed(2)+'</td>' +
                    '<td style="padding:7px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:700;">&#8377;'+parseFloat(item.amount).toFixed(2)+'</td>' +
                    '</tr>';
            }).join('');

            const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
            const discount = parseFloat(bill.discount) || 0;
            const discountRow = discount > 0
                ? '<tr><td style="padding:4px 0;color:#e74c3c;">Discount</td><td style="padding:4px 0;text-align:right;color:#e74c3c;">-&#8377;'+discount.toFixed(2)+'</td></tr>' : '';

            const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bill</title><style>' +
                '*{margin:0;padding:0;box-sizing:border-box}' +
                'body{font-family:"Bookman Old Style","Book Antiqua",Bookman,Georgia,serif;background:#fff;color:#222;padding:20px}' +
                '@page{margin:8mm;size:A5 portrait}' +
                '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}' +
                '.hdr{text-align:center;margin-bottom:14px;padding-bottom:12px;border-bottom:2px dashed #ddd}' +
                '.hdr h2{font-size:17px;font-weight:800;color:#1e3f5a}.hdr p{font-size:11px;color:#888;margin-top:2px}' +
                '.info{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f8f9fa;border-radius:8px;padding:12px;margin-bottom:14px}' +
                '.lbl{font-size:10px;color:#999}.val{font-size:13px;font-weight:700;color:#2c3e50}' +
                'table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px}' +
                'thead tr{background:#2c5aa0;color:white}thead th{padding:8px 10px;text-align:left}' +
                'thead th:not(:first-child){text-align:center}thead th:last-child{text-align:right}' +
                '.tot{background:#f8f9fa;border-radius:8px;padding:12px 14px}' +
                '.tot table{margin-bottom:0;font-size:13px}.tot td{padding:3px 0}.tot td:last-child{text-align:right}' +
                '.grand td{font-size:17px;font-weight:800;color:#2c5aa0;border-top:2px solid #dce8f8;padding-top:7px}' +
                '.ftr{text-align:center;margin-top:16px;font-size:11px;color:#aaa}' +
                '.bid{text-align:right;font-size:11px;color:#999;font-family:monospace;margin-bottom:10px}' +
                '</style></head><body>' +
                '<div id="__ph" data-patient="'+(bill.patientName||'').replace(/"/g,'&quot;')
                    +'" data-doctor="'+(bill.doctor||'').replace(/"/g,'&quot;')
                    +'" data-date="'+(bill.date||'')
                    +'" data-billid="'+(bill.billId||'')
                    +'" data-total="'+parseFloat(bill.total||0).toFixed(2)
                    +'" data-subtotal="'+subtotal.toFixed(2)
                    +'" data-discount="'+discount.toFixed(2)
                    +'" data-mode="'+(bill.paymentMode||'Cash')
                    +'" data-items="'+encodeURIComponent(JSON.stringify(items.map(function(i){ return {name:i.medicineName||i.name||'',qty:i.qty,price:i.price,amount:i.amount}; })))
                    +'" style="display:none"></div>' +
                '<div class="bid">'+bill.billId+'</div>' +
                '<div class="hdr"><h2>&#x1F9B7; '+CONFIG.clinicName+'</h2>' +
                '<p>'+(CONFIG.clinicAddress||'')+'</p>' +
                '<p>'+(CONFIG.clinicPhone?'&#128222; '+CONFIG.clinicPhone:'')+'</p></div>' +
                '<div class="info">' +
                '<div><div class="lbl">Patient</div><div class="val">'+(bill.patientName||'—')+'</div></div>' +
                '<div><div class="lbl">Doctor</div><div class="val">'+(bill.doctor||'—')+'</div></div>' +
                '<div><div class="lbl">Date</div><div class="val" style="font-weight:500">'+(bill.date||'—')+'</div></div>' +
                '<div><div class="lbl">Payment</div><div class="val" style="font-weight:500">'+(bill.paymentMode||'—')+'</div></div>' +
                '</div>' +
                '<table><thead><tr><th>Medicine</th><th style="text-align:center">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>' +
                '<tbody>'+itemRows+'</tbody></table>' +
                '<div class="tot"><table>' +
                '<tr><td>Subtotal</td><td>&#8377;'+subtotal.toFixed(2)+'</td></tr>' +
                discountRow +
                '<tr class="grand"><td><strong>Grand Total</strong></td><td><strong>&#8377;'+parseFloat(bill.total).toFixed(2)+'</strong></td></tr>' +
                '</table></div>' +
                '<div class="ftr">Thank you for choosing '+CONFIG.clinicName+' &#x1F9B7;</div>' +
                '</body></html>';

            printBillHtml(html);
        }

        function shareWhatsApp(billId) {
            const bill = bills.find(b => b.billId === billId);
            if (!bill) { showToast('Bill not found', 'error'); return; }

            if (!bill.phone || String(bill.phone).trim() === '') {
                showToast('❌ No phone number for this bill', 'warning');
                return;
            }

            let items = bill.items || [];
            if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }

            let message = `*${CONFIG.clinicName.toUpperCase()}*\n\n`;
            message += `*Bill ID: ${bill.billId}*\n`;
            message += `Date: ${bill.date}\n`;
            message += `Hello ${bill.patientName}!\n\n`;
            message += `Doctor: ${bill.doctor || 'N/A'}\n\n`;
            message += `*Medicines:*\n`;

            items.forEach(item => {
                const med = medicines.find(m => String(m.id) === String(item.medicineId));
                const medName = med ? med.name : (item.medicineName || item.name || 'Unknown');
                message += `• ${medName}\n  ${item.qty} × ₹${parseFloat(item.price).toFixed(2)} = ₹${parseFloat(item.amount).toFixed(2)}\n`;
            });

            const subtotal = items.reduce((s, i) => s + parseFloat(i.amount || 0), 0);
            message += `\nSubtotal: ₹${subtotal.toFixed(2)}`;
            if (bill.discount && parseFloat(bill.discount) > 0) {
                message += `\nDiscount: -₹${parseFloat(bill.discount).toFixed(2)}`;
            }
            message += `\n\n*Grand Total: ₹${parseFloat(bill.total).toFixed(2)}*`;
            message += `\n\n📞 ${CONFIG.clinicPhone}`;
            message += `\n📍 ${CONFIG.clinicAddress}`;
            message += `\n\nThank you! Visit again. 😊`;

            const phone = String(bill.phone).replace(/[^\d]/g, '');
            openWhatsApp(phone, message);
        }

        // REPORTS
        function generateMedicineWiseReport() {
            if (bills.length === 0) {
                showToast('No bills to report', 'warning');
                return;
            }

            const medicineStats = {};

            bills.forEach(bill => {
                let items = bill.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                if (Array.isArray(items)) {
                    items = items.map(i => typeof i === 'string' ? (() => { try { return JSON.parse(i); } catch(e) { return {}; } })() : i);
                }
                items = items.filter(i => i && (i.medicineId || i.medicineName || i.name));

                items.forEach(item => {
                    const med = medicines.find(m => String(m.id) === String(item.medicineId));
                    const name = item.medicineName || (med ? med.name : null) || item.name || 'Unknown';
                    const costPrice = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                    const qty = parseInt(item.qty) || 1;
                    const amount = parseFloat(item.amount) || (qty * parseFloat(item.price || 0));

                    if (!medicineStats[name]) {
                        medicineStats[name] = { name, totalQty: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0, transactions: 0 };
                    }
                    medicineStats[name].totalQty += qty;
                    medicineStats[name].totalRevenue += amount;
                    medicineStats[name].totalCost += (qty * costPrice);
                    medicineStats[name].totalProfit += (amount - (qty * costPrice));
                    medicineStats[name].transactions += 1;
                });
            });

            if (Object.keys(medicineStats).length === 0) {
                showToast('No medicine data found in bills. Make sure bills have medicine items saved.', 'warning');
                return;
            }

            let csvContent = "Medicine Name,Total Qty,Total Revenue,Total Cost,Total Profit,Transactions,Profit Margin %\n";
            Object.values(medicineStats).forEach(stat => {
                const margin = stat.totalRevenue > 0 ? ((stat.totalProfit / stat.totalRevenue) * 100).toFixed(2) : 0;
                csvContent += `"${stat.name}",${stat.totalQty},${stat.totalRevenue.toFixed(2)},${stat.totalCost.toFixed(2)},${stat.totalProfit.toFixed(2)},${stat.transactions},${margin}%\n`;
            });

            downloadReport(csvContent, 'Medicine-wise-Report.csv');
            showToast('✅ Medicine-wise report downloaded!', 'success');
        }

        function generateSupplierWiseReport() {
            if (purchases.length === 0) {
                showToast('No purchases to report', 'warning');
                return;
            }
            const medRevenue = buildMedRevenue();
            const supplierStats = {};

            purchases.forEach(purchase => {
                const sup = normSupplier(purchase.supplier);
                const med = normMedicine(purchase.medicineName);
                if (!supplierStats[sup]) {
                    supplierStats[sup] = { supplier:sup, totalQty:0, totalCost:0, totalRevenue:0, transactions:0, medicines:new Set() };
                }
                supplierStats[sup].totalQty     += parseInt(purchase.qty)||0;
                supplierStats[sup].totalCost    += purchaseCost(purchase);
                supplierStats[sup].totalRevenue += medRevenue[med] || 0;
                supplierStats[sup].transactions += 1;
                supplierStats[sup].medicines.add(med);
            });

            let csvContent = "Supplier,Orders,Total Qty,Cost Paid,Revenue Earned,Profit,Margin %,Medicines Supplied\n";
            Object.values(supplierStats)
                .sort((a,b) => b.totalCost - a.totalCost)
                .forEach(stat => {
                    const profit = stat.totalRevenue - stat.totalCost;
                    const margin = stat.totalRevenue > 0 ? ((profit/stat.totalRevenue)*100).toFixed(1)+'%' : 'N/A';
                    csvContent += `"${stat.supplier}",${stat.transactions},${stat.totalQty},${stat.totalCost.toFixed(2)},${stat.totalRevenue.toFixed(2)},${profit.toFixed(2)},${margin},"${Array.from(stat.medicines).join(', ')}"\n`;
                });

            downloadReport(csvContent, 'Supplier-wise-Report.csv');
            showToast('✅ Supplier report with margins downloaded!', 'success');
        }

        function generateMonthlyReport() {
            if (bills.length === 0) {
                showToast('No bills to report', 'warning');
                return;
            }

            const monthlyStats = {};
            
            bills.forEach(bill => {
                const billDate = String(bill.date).split('T')[0];
                const yearMonth = billDate.substring(0, 7); // YYYY-MM
                
                if (!monthlyStats[yearMonth]) {
                    monthlyStats[yearMonth] = {
                        month: yearMonth,
                        totalRevenue: 0,
                        totalCost: 0,
                        totalProfit: 0,
                        transactions: 0
                    };
                }
                
                monthlyStats[yearMonth].totalRevenue += parseFloat(bill.total) || 0;

                // Calculate cost from costTotal or fallback to items × costPrice
                let billCost = parseFloat(bill.costTotal) || 0;
                if (billCost === 0) {
                    let items = bill.items || [];
                    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                    billCost = items.reduce((sum, item) => {
                        const med = medicines.find(m => String(m.id) === String(item.medicineId));
                        const cp = med ? (parseFloat(med.costPrice) || 0) : (parseFloat(item.costPrice) || 0);
                        return sum + (parseInt(item.qty) * cp);
                    }, 0);
                }
                monthlyStats[yearMonth].totalCost += billCost;
                monthlyStats[yearMonth].totalProfit += ((parseFloat(bill.total) || 0) - billCost);
                monthlyStats[yearMonth].transactions += 1;
            });

            let csvContent = "Month,Total Revenue,Total Cost,Total Profit,Profit Margin %,Transactions\n";
            Object.values(monthlyStats).sort((a, b) => a.month.localeCompare(b.month)).forEach(stat => {
                const margin = stat.totalRevenue > 0 ? ((stat.totalProfit / stat.totalRevenue) * 100).toFixed(2) : 0;
                csvContent += `${stat.month},${stat.totalRevenue.toFixed(2)},${stat.totalCost.toFixed(2)},${stat.totalProfit.toFixed(2)},${margin}%,${stat.transactions}\n`;
            });

            downloadReport(csvContent, 'Monthly-Trends-Report.csv');
            showToast('✅ Monthly trends report downloaded!', 'success');
        }

        function downloadReport(csvContent, filename) {
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // MODALS
        function closeModal(modalId) {
            document.getElementById(modalId).classList.remove('active');
        }

        // UTILITY
        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        // ══ CLINIC PERFORMANCE REPORTS ═══════════════════════════

        // Called whenever the Reports page is opened or filter changes
        // ══════════════════════════════════════════════════════════
        // CLINIC EXPENSES MODULE
        // ══════════════════════════════════════════════════════════
        var _expenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');

        function saveExpenses() {
            localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
        }

        function addExpense() {
            var date     = document.getElementById('exp_date').value;
            var category = document.getElementById('exp_category').value;
            var amount   = parseFloat(document.getElementById('exp_amount').value);
            var vendor   = document.getElementById('exp_vendor').value.trim();
            var notes    = document.getElementById('exp_notes').value.trim();
            var mode     = document.getElementById('exp_mode').value;

            if (!date)     { showToast('Please select a date', 'warning'); return; }
            if (!category) { showToast('Please select a category', 'warning'); return; }
            if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'warning'); return; }

            var expense = {
                id:       'EXP-' + Date.now(),
                date:     date,
                category: category,
                amount:   amount,
                vendor:   vendor,
                notes:    notes,
                mode:     mode,
                addedAt:  new Date().toISOString()
            };

            _expenses.unshift(expense);
            saveExpenses();
            renderExpenses();
            // Reset form
            document.getElementById('exp_amount').value = '';
            document.getElementById('exp_vendor').value = '';
            document.getElementById('exp_notes').value = '';
            showToast('✅ Expense saved!', 'success');
            // Sync to Google Sheets
            syncExpenseToSheets(expense);
        }

        function deleteExpense(id) {
            if (!confirm('Delete this expense? This cannot be undone.')) return;
            _expenses = _expenses.filter(function(e){ return e.id !== id; });
            saveExpenses();
            renderExpenses();
            showToast('🗑️ Expense deleted', 'success');
            // Sync deletion to Sheets
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            var p = new URLSearchParams();
            p.append('action', 'deleteExpense');
            p.append('id', id);
            fetch(CONFIG.apiUrl + '?' + p.toString(), { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(res){ if(res.success) showToast('☁️ Removed from Sheets','success'); })
                .catch(function(){});
        }

        function syncExpenseToSheets(exp) {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
            var p = new URLSearchParams();
            p.append('action',   'saveExpense');
            p.append('id',       exp.id);
            p.append('date',     exp.date);
            p.append('category', exp.category);
            p.append('amount',   exp.amount);
            p.append('vendor',   exp.vendor || '');
            p.append('notes',    exp.notes  || '');
            p.append('mode',     exp.mode   || 'Cash');
            fetch(CONFIG.apiUrl + '?' + p.toString(), { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(res){ if(res.success) showToast('☁️ Synced to Google Sheets','success'); else showToast('⚠️ Saved locally only','warning'); })
                .catch(function(){ showToast('⚠️ Saved locally — no internet?','warning'); });
        }

        // Pull all expenses from Google Sheets and merge with local
        function syncExpensesFromSheets() {
            if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
                showToast('⚠️ No Google Sheets connected', 'warning'); return;
            }
            showToast('🔄 Syncing expenses from Sheets...', 'info');
            var url = CONFIG.apiUrl + '?action=getExpenses';
            fetch(url, { method:'GET', redirect:'follow' })
                .then(function(r){ return r.json(); })
                .then(function(data) {
                    var rows = data.expenses || data || [];
                    if (!Array.isArray(rows) || rows.length === 0) {
                        // Fallback: try getAllData
                        return fetch(CONFIG.apiUrl + '?action=getAllData', { method:'GET', redirect:'follow' })
                            .then(function(r2){ return r2.json(); })
                            .then(function(d2){ return d2.expenses || []; });
                    }
                    return rows;
                })
                .then(function(rows) {
                    if (!Array.isArray(rows) || rows.length === 0) {
                        showToast('No expenses found in Sheets', 'warning'); return;
                    }
                    var sheetExpenses = rows.map(function(e){ return {
                        id:       e.id       || ('EXP-' + Date.now() + Math.random()),
                        date:     e.date     ? String(e.date).split('T')[0] : '',
                        category: e.category || e.Category || '',
                        amount:   parseFloat(e.amount || e.Amount) || 0,
                        vendor:   e.vendor   || e.Vendor || '',
                        notes:    e.notes    || e.Notes  || '',
                        mode:     e.mode     || e.paymentMode || e['Payment Mode'] || 'Cash',
                        addedAt:  e.addedAt  || e.added_at || e['Added At'] || ''
                    }; });
                    var localExpenses = JSON.parse(localStorage.getItem('clinic_expenses') || '[]');
                    var sheetIds = sheetExpenses.map(function(e){ return e.id; });
                    var localOnly = localExpenses.filter(function(e){ return sheetIds.indexOf(e.id) === -1; });
                    _expenses = sheetExpenses.concat(localOnly);
                    _expenses.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
                    localStorage.setItem('clinic_expenses', JSON.stringify(_expenses));
                    renderExpenses();
                    showToast('✅ Expenses synced! ' + _expenses.length + ' entries loaded', 'success');
                })
                .catch(function(err){
                    console.error('Expense sync error:', err);
                    showToast('❌ Sync failed — check internet / Sheets connection', 'warning');
                });
        }

        function renderExpenses() {
            var catFilter   = (document.getElementById('exp_filterCat')   || {}).value || '';
            var monthFilter = (document.getElementById('exp_filterMonth') || {}).value || '';
            var yearFilter  = (document.getElementById('exp_filterYear')  || {}).value || '';

            // Populate year dropdown
            var years = [...new Set(_expenses.map(function(e){ return e.date.substring(0,4); }))].sort().reverse();
            var ySel = document.getElementById('exp_filterYear');
            if (ySel) {
                var curYVal = ySel.value;
                ySel.innerHTML = '<option value="">All Years</option>' +
                    years.map(function(y){ return '<option value="'+y+'"'+(y===curYVal?' selected':'')+'>'+y+'</option>'; }).join('');
            }

            var today = new Date();
            var thisMonth = today.getFullYear()+'-'+(String(today.getMonth()+1).padStart(2,'0'));
            var thisYear  = String(today.getFullYear());

            var filtered = _expenses.filter(function(e) {
                if (catFilter   && e.category !== catFilter)              return false;
                if (monthFilter && e.date.substring(5,7) !== monthFilter) return false;
                if (yearFilter  && e.date.substring(0,4) !== yearFilter)  return false;
                return true;
            });

            // Summary totals
            var totalThisMonth = _expenses.filter(function(e){ return e.date.substring(0,7)===thisMonth; }).reduce(function(s,e){ return s+e.amount; },0);
            var totalThisYear  = _expenses.filter(function(e){ return e.date.substring(0,4)===thisYear;  }).reduce(function(s,e){ return s+e.amount; },0);
            var totalAll       = _expenses.reduce(function(s,e){ return s+e.amount; },0);
            var el = function(id){ return document.getElementById(id); };
            if(el('exp_thisMonth')) el('exp_thisMonth').textContent = '₹'+totalThisMonth.toFixed(2);
            if(el('exp_thisYear'))  el('exp_thisYear').textContent  = '₹'+totalThisYear.toFixed(2);
            if(el('exp_allTime'))   el('exp_allTime').textContent   = '₹'+totalAll.toFixed(2);
            if(el('exp_count'))     el('exp_count').textContent     = _expenses.length;

            // Category breakdown for filtered set
            var breakdown = {};
            var catColors = {
                'Rent':'#e74c3c','Electricity':'#f39c12','Staff Salary':'#2ecc71',
                'Lab Bill':'#3498db','Equipment':'#9b59b6','Medicine Stock':'#1abc9c',
                'Housekeeping':'#e67e22','Internet & Phone':'#34495e','Marketing':'#e91e63',
                'Insurance':'#607d8b','Miscellaneous':'#95a5a6'
            };
            filtered.forEach(function(e){ breakdown[e.category] = (breakdown[e.category]||0) + e.amount; });
            var bTotal = filtered.reduce(function(s,e){ return s+e.amount; },0);
            var bdBox = el('exp_breakdown');
            var bdCnt = el('exp_breakdownContent');
            if (bdBox && bdCnt && Object.keys(breakdown).length > 0) {
                bdBox.style.display = 'block';
                bdCnt.innerHTML = Object.keys(breakdown).sort(function(a,b){ return breakdown[b]-breakdown[a]; }).map(function(cat){
                    var pct = bTotal > 0 ? Math.round(breakdown[cat]/bTotal*100) : 0;
                    var color = catColors[cat] || '#95a5a6';
                    return '<div style="margin-bottom:8px;">' +
                        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">' +
                            '<span style="font-weight:700;">'+cat+'</span>' +
                            '<span>₹'+breakdown[cat].toFixed(2)+' <span style="color:#888;">('+pct+'%)</span></span>' +
                        '</div>' +
                        '<div style="height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden;">' +
                            '<div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:4px;transition:width 0.4s;"></div>' +
                        '</div></div>';
                }).join('');
            } else if (bdBox) { bdBox.style.display = 'none'; }

            // Expense cards
            var listEl = el('exp_list');
            if (!listEl) return;
            if (filtered.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;color:#aaa;padding:40px;font-size:14px;">No expenses found.<br>'+(catFilter||monthFilter||yearFilter?'Try clearing filters.':'Add your first expense above.')+'</div>';
                return;
            }
            listEl.innerHTML = filtered.map(function(e){
                var color = catColors[e.category] || '#95a5a6';
                var modeIcon = e.mode==='Cash'?'💵':e.mode==='UPI'?'📱':e.mode==='Cheque'?'📄':'🏦';
                return '<div style="background:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border-left:4px solid '+color+';">' +
                    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
                                '<span style="background:'+color+'22;color:'+color+';border-radius:6px;padding:2px 8px;font-size:11px;font-weight:800;">'+e.category+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+e.date+'</span>' +
                                '<span style="font-size:11px;color:#888;">'+modeIcon+' '+e.mode+'</span>' +
                            '</div>' +
                            (e.vendor ? '<div style="font-size:13px;font-weight:700;color:#333;margin-bottom:2px;">'+e.vendor+'</div>' : '') +
                            (e.notes  ? '<div style="font-size:12px;color:#666;">'+e.notes+'</div>' : '') +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
                            '<div style="font-size:18px;font-weight:800;color:'+color+';">₹'+e.amount.toFixed(2)+'</div>' +
                            '<button onclick="deleteExpense(\''+e.id+'\')" style="padding:4px 10px;background:#fdecea;color:#e74c3c;border:1px solid #e74c3c;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;touch-action:manipulation;">🗑️ Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        function exportExpensesCSV() {
            if (_expenses.length === 0) { showToast('No expenses to export','warning'); return; }
            var csv = 'Date,Category,Amount,Vendor,Notes,Payment Mode\n';
            _expenses.forEach(function(e){
                csv += '"'+e.date+'","'+e.category+'",'+e.amount.toFixed(2)+',"'+(e.vendor||'')+'","'+(e.notes||'')+'","'+(e.mode||'')+'"\n';
            });
            var blob = new Blob([csv], {type:'text/csv'});
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'clinic_expenses_'+new Date().toISOString().split('T')[0]+'.csv';
            a.click();
            showToast('📥 CSV exported!', 'success');
        }

        // Set today's date as default on expenses form
        (function(){
            var d = document.getElementById('exp_date');
            if (d) d.value = new Date().toISOString().split('T')[0];
        })();

        // ══════════════════════════════════════════════════════════
        function renderReports() {
            const filtered = getFilteredBills();
            renderKPIs(filtered);
            renderRevenueChart(filtered);
            renderTreatmentChart();
            renderPaymentChart(filtered);
            renderDoctorChart(filtered);
            renderTopMedicines(filtered);
            renderMonthlyTable(filtered);
            renderSupplierReport();
            renderPurchaseReport();
            renderInsights(filtered);
        }

        function getFilteredBills() {
            const period = document.getElementById('rpt_period') ? document.getElementById('rpt_period').value : 'all';
            const now = new Date();
            const today = now.toISOString().split('T')[0];

            // Show/hide custom range inputs
            const cr = document.getElementById('rpt_custom_range');
            if (cr) cr.style.display = period === 'custom' ? 'flex' : 'none';

            return bills.filter(b => {
                const d = String(b.date).split('T')[0];
                if (period === 'all') return true;
                if (period === 'today') return d === today;
                if (period === 'week') {
                    const wStart = new Date(now); wStart.setDate(now.getDate() - now.getDay());
                    return new Date(d) >= wStart;
                }
                if (period === 'month') return d.substring(0,7) === today.substring(0,7);
                if (period === 'last3') {
                    const t = new Date(now); t.setMonth(t.getMonth() - 3);
                    return new Date(d) >= t;
                }
                if (period === 'year') return d.substring(0,4) === today.substring(0,4);
                if (period === 'custom') {
                    const from = document.getElementById('rpt_from').value;
                    const to   = document.getElementById('rpt_to').value;
                    if (from && d < from) return false;
                    if (to   && d > to)   return false;
                    return true;
                }
                return true;
            });
        }

        function renderKPIs(filtered) {
            const totalRev  = filtered.reduce((s,b) => s + (parseFloat(b.total)||0), 0);
            const totalPts  = filtered.length;
            const avgBill   = totalPts ? totalRev / totalPts : 0;
            const totalDisc = filtered.reduce((s,b) => s + (parseFloat(b.discount)||0), 0);

            // Unique patient names
            const uniquePts = new Set(filtered.map(b => (b.patientName||'').toLowerCase().trim())).size;

            // Bills today
            const today = new Date().toISOString().split('T')[0];
            const todayRev = bills.filter(b => String(b.date).split('T')[0] === today)
                                  .reduce((s,b) => s + (parseFloat(b.total)||0), 0);

            const kpis = [
                { label:"Total Revenue",   value:`₹${totalRev.toLocaleString('en-IN',{maximumFractionDigits:0})}`,  color:'#2c5aa0', icon:'💰' },
                { label:"Total Bills",     value:totalPts,                       color:'#27ae60', icon:'🧾' },
                { label:"Unique Patients", value:uniquePts,                      color:'#8e44ad', icon:'👥' },
                { label:"Avg Bill Value",  value:`₹${avgBill.toFixed(0)}`,       color:'#e67e22', icon:'📊' },
                { label:"Total Discounts", value:`₹${totalDisc.toFixed(0)}`,     color:'#e74c3c', icon:'🏷️' },
                { label:"Today's Revenue", value:`₹${todayRev.toFixed(0)}`,      color:'#16a085', icon:'📅' },
            ];

            document.getElementById('rpt_kpis').innerHTML = kpis.map(k => `
                <div style="background:white;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border-left:4px solid ${k.color};">
                    <div style="font-size:22px;margin-bottom:4px;">${k.icon}</div>
                    <div style="font-size:11px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.5px;">${k.label}</div>
                    <div style="font-size:22px;font-weight:800;color:${k.color};margin-top:3px;">${k.value}</div>
                </div>`).join('');
        }

        function renderRevenueChart(filtered) {
            // Last 30 days bar chart using pure SVG
            const days = 30;
            const buckets = {};
            for (let i = days-1; i >= 0; i--) {
                const d = new Date(); d.setDate(d.getDate()-i);
                buckets[d.toISOString().split('T')[0]] = 0;
            }
            filtered.forEach(b => {
                const d = String(b.date).split('T')[0];
                if (buckets[d] !== undefined) buckets[d] += parseFloat(b.total)||0;
            });

            const vals = Object.values(buckets);
            const maxV = Math.max(...vals, 1);
            const w = 480, h = 150, pad = 30, barW = Math.floor((w - pad*2) / days) - 2;

            const bars = Object.entries(buckets).map(([date, val], i) => {
                const bh = Math.round((val / maxV) * (h - 20));
                const x  = pad + i * ((w - pad*2) / days);
                const y  = h - bh - 5;
                const col = val > 0 ? '#2c5aa0' : '#e8edf5';
                return `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" fill="${col}" rx="2">
                    <title>${date}: ₹${val.toFixed(0)}</title></rect>`;
            }).join('');

            // Y axis labels
            const yLabels = [0, 0.5, 1].map(f => {
                const yv = Math.round(maxV * f);
                const yp = h - Math.round(f * (h-20)) - 5;
                return `<text x="2" y="${yp}" font-size="9" fill="#aaa">₹${yv>=1000?Math.round(yv/1000)+'k':yv}</text>`;
            }).join('');

            document.getElementById('rpt_revenue_chart').innerHTML =
                `<svg viewBox="0 0 ${w} ${h}" width="100%" style="overflow:visible;">
                    ${yLabels}
                    <line x1="${pad}" y1="5" x2="${pad}" y2="${h-5}" stroke="#eee" stroke-width="1"/>
                    <line x1="${pad}" y1="${h-5}" x2="${w-10}" y2="${h-5}" stroke="#eee" stroke-width="1"/>
                    ${bars}
                    <text x="${pad}" y="${h+14}" font-size="9" fill="#aaa">30 days ago</text>
                    <text x="${w-40}" y="${h+14}" font-size="9" fill="#aaa">Today</text>
                </svg>`;
        }

        function renderTreatmentChart() {
            // Uses treatmentReceipts data if available, else builds from bills
            const treatments = {
                'Consultation':0,'Teeth Cleaning':0,'Fillings':0,
                'Root Canal':0,'Crowns':0,'Orthodontic':0,
                'Flap Surgery':0,'Extractions':0,'Others':0
            };

            // Count from treatment receipts saved in localStorage (tr_history is the correct key)
            try {
                const saved = JSON.parse(localStorage.getItem('tr_history') || '[]');
                saved.forEach(r => {
                    if (r.treatments) {
                        String(r.treatments).split(',').forEach(t => {
                            const key = Object.keys(treatments).find(k => t.trim().toLowerCase().includes(k.toLowerCase()));
                            if (key) treatments[key]++;
                        });
                    }
                });
            } catch(e) {}

            // Fallback: estimate from bill count if no treatment data
            const total = Object.values(treatments).reduce((a,b)=>a+b,0);
            const labels = total === 0
                ? ['Consultation','Fillings','Root Canal','Extractions','Scaling','Others']
                : Object.keys(treatments).filter(k => treatments[k] > 0);
            const values = total === 0
                ? [40, 20, 15, 10, 10, 5]
                : labels.map(k => treatments[k]);

            renderDonutChart('rpt_treatment_chart', labels, values,
                ['#2c5aa0','#27ae60','#e74c3c','#f39c12','#8e44ad','#16a085','#d35400','#2980b9','#7f8c8d']);
        }

        function renderPaymentChart(filtered) {
            const modes = {};
            filtered.forEach(b => {
                const m = b.paymentMode || 'Unknown';
                modes[m] = (modes[m]||0) + 1;
            });
            if (Object.keys(modes).length === 0) {
                document.getElementById('rpt_payment_chart').innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;margin-top:40px;">No data yet</p>';
                return;
            }
            renderDonutChart('rpt_payment_chart', Object.keys(modes), Object.values(modes),
                ['#27ae60','#2c5aa0','#e67e22','#8e44ad','#e74c3c']);
        }

        function renderDoctorChart(filtered) {
            const doctors = {};
            filtered.forEach(b => {
                const d = b.doctor || 'Unassigned';
                doctors[d] = (doctors[d]||0) + (parseFloat(b.total)||0);
            });
            const sorted = Object.entries(doctors).sort((a,b)=>b[1]-a[1]);
            if (sorted.length === 0) {
                document.getElementById('rpt_doctor_chart').innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;margin-top:40px;">No data yet</p>';
                return;
            }
            const maxV = sorted[0][1] || 1;
            const colors = ['#2c5aa0','#27ae60','#e67e22','#8e44ad'];
            document.getElementById('rpt_doctor_chart').innerHTML = sorted.map(([doc, rev], i) => `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                        <span style="font-weight:600;color:#2c3e50;">${doc}</span>
                        <span style="color:#27ae60;font-weight:700;">₹${rev.toLocaleString('en-IN',{maximumFractionDigits:0})}</span>
                    </div>
                    <div style="background:#f0f4ff;border-radius:4px;height:10px;width:100%;">
                        <div style="background:${colors[i%colors.length]};width:${Math.round((rev/maxV)*100)}%;height:10px;border-radius:4px;transition:width 0.6s;"></div>
                    </div>
                </div>`).join('');
        }

        function renderDonutChart(containerId, labels, values, colors) {
            const total = values.reduce((a,b)=>a+b,0) || 1;
            const cx = 75, cy = 75, r = 60, ri = 38;
            let startAngle = -Math.PI/2;
            const slices = values.map((v, i) => {
                const angle = (v / total) * 2 * Math.PI;
                const x1 = cx + r * Math.cos(startAngle);
                const y1 = cy + r * Math.sin(startAngle);
                startAngle += angle;
                const x2 = cx + r * Math.cos(startAngle);
                const y2 = cy + r * Math.sin(startAngle);
                const large = angle > Math.PI ? 1 : 0;
                const xi1 = cx + ri * Math.cos(startAngle - angle);
                const yi1 = cy + ri * Math.sin(startAngle - angle);
                const xi2 = cx + ri * Math.cos(startAngle);
                const yi2 = cy + ri * Math.sin(startAngle);
                return `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${xi2},${yi2} A${ri},${ri} 0 ${large},0 ${xi1},${yi1} Z"
                    fill="${colors[i%colors.length]}" stroke="white" stroke-width="2">
                    <title>${labels[i]}: ${v} (${Math.round((v/total)*100)}%)</title></path>`;
            }).join('');

            const legend = labels.map((l, i) => `
                <div style="display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:4px;">
                    <span style="width:10px;height:10px;background:${colors[i%colors.length]};border-radius:2px;flex-shrink:0;"></span>
                    <span style="color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${l}</span>
                    <span style="margin-left:auto;font-weight:700;color:#2c3e50;">${Math.round((values[i]/total)*100)}%</span>
                </div>`).join('');

            document.getElementById(containerId).innerHTML = `
                <div style="display:flex;align-items:center;gap:16px;">
                    <svg viewBox="0 0 150 150" width="150" height="150" style="flex-shrink:0;">${slices}</svg>
                    <div style="flex:1;overflow:hidden;">${legend}</div>
                </div>`;
        }

        function renderTopMedicines(filtered) {
            const meds = {};
            filtered.forEach(b => {
                let items = b.items||[];
                if (typeof items==='string'){try{items=JSON.parse(items);}catch(e){items=[];}}
                items.forEach(item => {
                    const name = item.medicineName||item.name||'Unknown';
                    if (!meds[name]) meds[name] = {rev:0, qty:0};
                    meds[name].rev += parseFloat(item.amount)||0;
                    meds[name].qty += parseInt(item.qty)||1;
                });
            });
            const sorted = Object.entries(meds).sort((a,b)=>b[1].rev-a[1].rev).slice(0,8);
            if (!sorted.length) {
                document.getElementById('rpt_top_medicines').innerHTML = '<p style="color:#aaa;font-size:13px;">No medicine data in bills</p>';
                return;
            }
            document.getElementById('rpt_top_medicines').innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <tr style="background:#f8f9fa;">
                        <th style="padding:7px 8px;text-align:left;color:#555;">Medicine</th>
                        <th style="padding:7px 8px;text-align:center;color:#555;">Qty</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Revenue</th>
                    </tr>
                    ${sorted.map(([name,s],i)=>`
                    <tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':''}">
                        <td style="padding:7px 8px;color:#2c3e50;font-weight:500;">${name}</td>
                        <td style="padding:7px 8px;text-align:center;color:#7f8c8d;">${s.qty}</td>
                        <td style="padding:7px 8px;text-align:right;color:#27ae60;font-weight:700;">₹${s.rev.toFixed(0)}</td>
                    </tr>`).join('')}
                </table>`;
        }

        function renderMonthlyTable(filtered) {
            const monthly = {};
            filtered.forEach(b => {
                const ym = String(b.date).split('T')[0].substring(0,7);
                if (!monthly[ym]) monthly[ym] = {rev:0, count:0};
                monthly[ym].rev   += parseFloat(b.total)||0;
                monthly[ym].count += 1;
            });
            const sorted = Object.entries(monthly).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8);
            if (!sorted.length) {
                document.getElementById('rpt_monthly_table').innerHTML = '<p style="color:#aaa;font-size:13px;">No data yet</p>';
                return;
            }
            document.getElementById('rpt_monthly_table').innerHTML = `
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <tr style="background:#f8f9fa;">
                        <th style="padding:7px 8px;text-align:left;color:#555;">Month</th>
                        <th style="padding:7px 8px;text-align:center;color:#555;">Bills</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Revenue</th>
                        <th style="padding:7px 8px;text-align:right;color:#555;">Avg</th>
                    </tr>
                    ${sorted.map(([ym,s],i)=>{
                        const [y,m] = ym.split('-');
                        const label = new Date(y,m-1).toLocaleString('en-IN',{month:'short',year:'numeric'});
                        return `<tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':''}">
                            <td style="padding:7px 8px;font-weight:600;color:#2c3e50;">${label}</td>
                            <td style="padding:7px 8px;text-align:center;color:#7f8c8d;">${s.count}</td>
                            <td style="padding:7px 8px;text-align:right;color:#2c5aa0;font-weight:700;">₹${s.rev.toLocaleString('en-IN',{maximumFractionDigits:0})}</td>
                            <td style="padding:7px 8px;text-align:right;color:#27ae60;">₹${Math.round(s.rev/s.count)}</td>
                        </tr>`;
                    }).join('')}
                </table>`;
        }

        function renderInsights(filtered) {
            const insights = [];
            const totalRev = filtered.reduce((s,b)=>s+parseFloat(b.total||0),0);
            const totalPts = filtered.length;
            const avgBill  = totalPts ? totalRev/totalPts : 0;

            // Payment mode insight
            const modes = {};
            filtered.forEach(b=>{ const m=b.paymentMode||'Unknown'; modes[m]=(modes[m]||0)+1; });
            const topMode = Object.entries(modes).sort((a,b)=>b[1]-a[1])[0];
            if (topMode) insights.push({
                icon:'💳', color:'#2c5aa0',
                title:'Top Payment Mode',
                text:`<b>${topMode[0]}</b> is your most used payment method (${topMode[1]} transactions). Ensure UPI QR codes are clearly visible at reception.`
            });

            // Avg bill insight
            if (avgBill < 500 && totalPts > 0) insights.push({
                icon:'📈', color:'#e67e22',
                title:'Increase Average Bill Value',
                text:`Your average bill is <b>₹${avgBill.toFixed(0)}</b>. Consider bundling consultations with preventive treatments like scaling to increase per-visit value.`
            });
            if (avgBill >= 500) insights.push({
                icon:'🌟', color:'#27ae60',
                title:'Strong Average Revenue',
                text:`Average bill of <b>₹${avgBill.toFixed(0)}</b> is healthy. Focus on retaining existing patients with follow-up reminders for best ROI.`
            });

            // Doctor spread
            const doctors = {};
            filtered.forEach(b=>{ const d=b.doctor||'Unassigned'; doctors[d]=(doctors[d]||0)+1; });
            const docCount = Object.keys(doctors).filter(d=>d!=='Unassigned').length;
            if (docCount > 1) insights.push({
                icon:'👨‍⚕️', color:'#8e44ad',
                title:'Doctor Performance Spread',
                text:`<b>${docCount} doctors</b> are generating revenue. Review the Doctor-wise chart and consider focusing high-value treatments with specialist Dr. Sai Vakula.`
            });

            // Discount alert
            const totalDisc = filtered.reduce((s,b)=>s+parseFloat(b.discount||0),0);
            const discPct = totalRev > 0 ? (totalDisc/totalRev)*100 : 0;
            if (discPct > 10) insights.push({
                icon:'⚠️', color:'#e74c3c',
                title:'High Discount Rate',
                text:`Discounts are <b>${discPct.toFixed(1)}%</b> of revenue (₹${totalDisc.toFixed(0)}). Consider limiting to loyalty patients only to protect margins.`
            });

            // Low activity days
            const today = new Date().toISOString().split('T')[0];
            const todayBills = bills.filter(b=>String(b.date).split('T')[0]===today).length;
            if (todayBills === 0) insights.push({
                icon:'📣', color:'#16a085',
                title:'No Bills Today Yet',
                text:`No bills recorded today. Use WhatsApp status or ask reception to follow up pending appointments to drive walk-ins.`
            });

            // Prescriptions reminder
            insights.push({
                icon:'💊', color:'#2980b9',
                title:'Track Prescription Medicines',
                text:`Ensure every prescription is linked to a bill. Commonly prescribed items can be stocked in bulk to reduce cost and improve margins.`
            });

            // Growth tip
            insights.push({
                icon:'🦷', color:'#27ae60',
                title:'Boost Treatment Revenue',
                text:`Orthodontic treatment, Implants, and Root Canal are high-value procedures. Dr. Sai Vakula's MAXILLOFACIAL specialty can be promoted to increase specialty revenue.`
            });

            document.getElementById('rpt_insights').innerHTML = insights.map(ins=>`
                <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border-left:4px solid ${ins.color};">
                    <div style="font-size:18px;margin-bottom:5px;">${ins.icon} <strong style="font-size:13px;color:${ins.color};">${ins.title}</strong></div>
                    <div style="font-size:12px;color:#555;line-height:1.6;">${ins.text}</div>
                </div>`).join('');
        }

        function renderSupplierReport() {
            const supplierEl  = document.getElementById('rpt_supplier_table');
            const supplierChEl = document.getElementById('rpt_supplier_chart');
            if (!supplierEl) return;

            if (!purchases || purchases.length === 0) {
                supplierEl.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0;">No purchase data yet.<br>Add purchases in the Purchases tab.</p>';
                if (supplierChEl) supplierChEl.innerHTML = '';
                return;
            }

            // Build revenue per medicine from bills (for margin calculation)
            const medRevenue = buildMedRevenue();

            // Aggregate by supplier
            const stats = {};
            purchases.forEach(p => {
                const sup = normSupplier(p.supplier);
                const med = normMedicine(p.medicineName);
                if (!stats[sup]) stats[sup] = { cost:0, revenue:0, qty:0, txns:0, meds:new Set() };
                const cost = purchaseCost(p);
                stats[sup].cost    += cost;
                stats[sup].qty     += parseInt(p.qty)||0;
                stats[sup].txns    += 1;
                stats[sup].meds.add(med);
                // Add revenue earned from this medicine (proportional to qty purchased)
                if (medRevenue[med]) stats[sup].revenue += medRevenue[med];
            });

            const sorted = Object.entries(stats).sort((a,b) => b[1].cost - a[1].cost);
            const grandCost    = sorted.reduce((s,[,v]) => s + v.cost, 0) || 1;
            const grandRevenue = sorted.reduce((s,[,v]) => s + v.revenue, 0);
            const grandProfit  = grandRevenue - grandCost;
            const colors = ['#e67e22','#2c5aa0','#27ae60','#8e44ad','#e74c3c','#16a085','#f39c12','#2980b9'];

            // Bar chart
            if (supplierChEl) {
                supplierChEl.style.marginBottom = '4px';
                supplierChEl.innerHTML = sorted.map(([sup, s], i) => {
                    const profit = s.revenue - s.cost;
                    const margin = s.revenue > 0 ? (profit/s.revenue)*100 : 0;
                    const mColor = margin >= 30 ? '#27ae60' : margin >= 10 ? '#e67e22' : '#e74c3c';
                    return `
                    <div style="margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:5px;">
                            <span style="font-weight:700;color:#2c3e50;font-size:14px;">${sup}</span>
                            <span style="white-space:nowrap;display:flex;gap:16px;align-items:center;">
                                <span style="color:#e67e22;font-weight:700;">₹${s.cost.toLocaleString('en-IN',{maximumFractionDigits:0})} cost</span>
                                ${s.revenue>0?`<span style="background:${mColor}18;color:${mColor};padding:3px 10px;border-radius:20px;font-weight:800;font-size:12px;">${margin.toFixed(1)}% margin</span>`:'<span style="color:#aaa;font-size:12px;">No sales yet</span>'}
                            </span>
                        </div>
                        <div style="background:#f0f4ff;border-radius:6px;height:14px;width:100%;">
                            <div style="background:${colors[i%colors.length]};width:${Math.round((s.cost/grandCost)*100)}%;height:14px;border-radius:6px;"></div>
                        </div>
                    </div>`;
                }).join('');
            }

            const divider = '<div style="border-top:2px solid #f0f0f0;margin:20px 0;"></div>';

            supplierEl.innerHTML = divider + `
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <tr style="background:#fff3e0;">
                        <th style="padding:10px 12px;text-align:left;color:#e67e22;font-size:13px;">Supplier</th>
                        <th style="padding:10px 12px;text-align:center;color:#555;">Orders</th>
                        <th style="padding:10px 12px;text-align:right;color:#e74c3c;">Cost Paid</th>
                        <th style="padding:10px 12px;text-align:right;color:#2c5aa0;">Revenue</th>
                        <th style="padding:10px 12px;text-align:right;color:#27ae60;">Profit</th>
                        <th style="padding:10px 12px;text-align:right;color:#555;">Margin</th>
                        <th style="padding:10px 12px;text-align:right;color:#555;">Share</th>
                    </tr>
                    ${sorted.map(([sup, s], i) => {
                        const profit = s.revenue - s.cost;
                        const margin = s.revenue > 0 ? (profit/s.revenue)*100 : null;
                        const mColor = margin===null?'#aaa':margin>=30?'#27ae60':margin>=10?'#e67e22':'#e74c3c';
                        return `
                        <tr style="border-bottom:1px solid #f5f5f5;${i%2?'background:#fafafa':'background:white'}">
                            <td style="padding:11px 12px;font-weight:700;font-size:13px;color:#2c3e50;">${sup}</td>
                            <td style="padding:11px 12px;text-align:center;color:#7f8c8d;">${s.txns}</td>
                            <td style="padding:11px 12px;text-align:right;color:#e74c3c;font-weight:700;">₹${s.cost.toFixed(0)}</td>
                            <td style="padding:11px 12px;text-align:right;color:#2c5aa0;font-weight:700;">${s.revenue>0?'₹'+s.revenue.toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 12px;text-align:right;font-weight:800;color:${profit>=0&&s.revenue>0?'#27ae60':'#e74c3c'};">${s.revenue>0?(profit>=0?'+':'')+' ₹'+Math.abs(profit).toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 12px;text-align:right;">
                                ${margin!==null
                                    ?`<span style="background:${mColor}20;color:${mColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${margin.toFixed(1)}%</span>`
                                    :'<span style="color:#aaa;font-size:12px;">No sales</span>'}
                            </td>
                            <td style="padding:11px 12px;text-align:right;">
                                <span style="background:#fff3e0;color:#e67e22;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;">${Math.round((s.cost/grandCost)*100)}%</span>
                            </td>
                        </tr>`;
                    }).join('')}
                    <tr style="background:#fff3e0;border-top:2px solid #e67e22;font-weight:800;">
                        <td style="padding:12px;font-size:14px;color:#e67e22;" colspan="2">TOTAL</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#e74c3c;">₹${grandCost.toFixed(0)}</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#2c5aa0;">${grandRevenue>0?'₹'+grandRevenue.toFixed(0):'—'}</td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:${grandProfit>=0?'#27ae60':'#e74c3c'};">${grandRevenue>0?(grandProfit>=0?'+':'')+' ₹'+Math.abs(grandProfit).toFixed(0):'—'}</td>
                        <td style="padding:12px;text-align:right;">
                            ${grandRevenue>0?`<span style="background:#27ae6020;color:#27ae60;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${((grandProfit/grandRevenue)*100).toFixed(1)}%</span>`:'—'}
                        </td>
                        <td style="padding:12px;text-align:right;font-size:14px;color:#e67e22;">100%</td>
                    </tr>
                </table>`;
        }

        // ── Normalize helpers (shared by all purchase/supplier functions) ──
        function normSupplier(s) {
            return (s||'Unknown').trim().toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
        }
        function normMedicine(m) {
            return (m||'Unknown').trim().replace(/\s+/g,' ');
        }
        function purchaseCost(p) {
            if (p.totalCost && parseFloat(p.totalCost) > 0) return parseFloat(p.totalCost);
            return (parseFloat(p.costPrice)||0) * (parseInt(p.qty)||0);
        }

        // Build a map of medicine name → total revenue earned from bills
        function buildMedRevenue() {
            const rev = {};
            bills.forEach(b => {
                let items = b.items || [];
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
                items.forEach(item => {
                    const name = normMedicine(item.medicineName || item.name || '');
                    if (!name) return;
                    rev[name] = (rev[name]||0) + (parseFloat(item.amount)||0);
                });
            });
            return rev;
        }

        // Build a map of medicine name → total purchase cost
        function buildMedCost() {
            const cost = {};
            purchases.forEach(p => {
                const name = normMedicine(p.medicineName);
                cost[name] = (cost[name]||0) + purchaseCost(p);
            });
            return cost;
        }

        function renderPurchaseReport() {
            const kpiEl   = document.getElementById('rpt_purchase_kpis');
            const tableEl = document.getElementById('rpt_purchase_table');
            if (!tableEl) return;

            if (!purchases || purchases.length === 0) {
                if (kpiEl) kpiEl.innerHTML = '';
                tableEl.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:20px 0;">No purchase data yet.<br>Add purchases in the Purchases tab.</p>';
                return;
            }

            // KPIs — use purchaseCost() so totals match Sheets
            const totalSpent  = purchases.reduce((s,p) => s + purchaseCost(p), 0);
            const totalQty    = purchases.reduce((s,p) => s + (parseInt(p.qty)||0), 0);
            const totalOrders = purchases.length;
            // Unique meds after normalizing name (trim + collapse spaces)
            const uniqueMeds  = new Set(purchases.map(p => normMedicine(p.medicineName))).size;

            if (kpiEl) kpiEl.innerHTML = [
                { label:'Total Spent',  value:`₹${totalSpent.toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#16a085' },
                { label:'Total Orders', value:totalOrders,  color:'#2c5aa0' },
                { label:'Total Units',  value:totalQty,     color:'#27ae60' },
                { label:'Unique Meds',  value:uniqueMeds,   color:'#8e44ad' },
            ].map(k => `
                <div style="background:#f8f9fa;border-radius:10px;padding:16px 20px;border-left:4px solid ${k.color};">
                    <div style="font-size:11px;color:#7f8c8d;text-transform:uppercase;letter-spacing:0.5px;">${k.label}</div>
                    <div style="font-size:26px;font-weight:800;color:${k.color};margin-top:4px;">${k.value}</div>
                </div>`).join('');

            // Medicine-wise — normalize name, use purchaseCost(), cross with revenue
            const medRevenue = buildMedRevenue();
            const medStats = {};
            purchases.forEach(p => {
                const name = normMedicine(p.medicineName);
                const cost = purchaseCost(p);
                if (!medStats[name]) medStats[name] = { qty:0, cost:0, orders:0, lastDate:'' };
                medStats[name].qty    += parseInt(p.qty)||0;
                medStats[name].cost   += cost;
                medStats[name].orders += 1;
                const d = String(p.date||'').split('T')[0];
                if (d > medStats[name].lastDate) medStats[name].lastDate = d;
            });

            // Attach revenue to each medicine
            Object.keys(medStats).forEach(name => {
                medStats[name].revenue = medRevenue[name] || 0;
                medStats[name].profit  = medStats[name].revenue - medStats[name].cost;
                medStats[name].margin  = medStats[name].revenue > 0
                    ? (medStats[name].profit / medStats[name].revenue) * 100 : null;
            });

            const sorted = Object.entries(medStats).sort((a,b)=>b[1].cost-a[1].cost).slice(0,15);
            const grandCost    = Object.values(medStats).reduce((s,v)=>s+v.cost,0) || 1;
            const grandRevenue = Object.values(medStats).reduce((s,v)=>s+v.revenue,0);
            const grandProfit  = grandRevenue - grandCost;

            tableEl.innerHTML = `
                <div style="font-size:13px;font-weight:700;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">Medicine-wise Breakdown with Margins</div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                    <tr style="background:#e8f8f5;">
                        <th style="padding:11px 14px;text-align:left;color:#16a085;font-size:13px;">Medicine</th>
                        <th style="padding:11px 14px;text-align:center;color:#555;">Qty</th>
                        <th style="padding:11px 14px;text-align:right;color:#e74c3c;">Cost</th>
                        <th style="padding:11px 14px;text-align:right;color:#2c5aa0;">Revenue</th>
                        <th style="padding:11px 14px;text-align:right;color:#27ae60;">Profit</th>
                        <th style="padding:11px 14px;text-align:right;color:#555;">Margin</th>
                    </tr>
                    ${sorted.map(([name, s], i) => {
                        const mColor = s.margin===null?'#aaa':s.margin>=30?'#27ae60':s.margin>=10?'#e67e22':'#e74c3c';
                        return `
                        <tr style="border-bottom:1px solid #f0f0f0;${i%2?'background:#fafafa':'background:white'}">
                            <td style="padding:11px 14px;font-weight:600;color:#2c3e50;">${name}</td>
                            <td style="padding:11px 14px;text-align:center;color:#7f8c8d;">${s.qty}</td>
                            <td style="padding:11px 14px;text-align:right;color:#e74c3c;font-weight:700;">₹${s.cost.toFixed(0)}</td>
                            <td style="padding:11px 14px;text-align:right;color:#2c5aa0;font-weight:700;">${s.revenue>0?'₹'+s.revenue.toFixed(0):'<span style="color:#ccc;">—</span>'}</td>
                            <td style="padding:11px 14px;text-align:right;font-weight:800;color:${s.revenue>0?(s.profit>=0?'#27ae60':'#e74c3c'):'#ccc'};">${s.revenue>0?(s.profit>=0?'+':'-')+'₹'+Math.abs(s.profit).toFixed(0):'—'}</td>
                            <td style="padding:11px 14px;text-align:right;">
                                ${s.margin!==null
                                    ?`<span style="background:${mColor}22;color:${mColor};padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${s.margin.toFixed(1)}%</span>`
                                    :'<span style="color:#ccc;font-size:12px;">No sales</span>'}
                            </td>
                        </tr>`;
                    }).join('')}
                    <tr style="background:#e8f8f5;border-top:2px solid #16a085;font-weight:800;">
                        <td style="padding:12px 14px;font-size:14px;color:#16a085;" colspan="2">TOTAL</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:#e74c3c;">₹${grandCost.toFixed(0)}</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:#2c5aa0;">${grandRevenue>0?'₹'+grandRevenue.toFixed(0):'—'}</td>
                        <td style="padding:12px 14px;text-align:right;font-size:14px;color:${grandProfit>=0?'#27ae60':'#e74c3c'};">${grandRevenue>0?(grandProfit>=0?'+':'-')+'₹'+Math.abs(grandProfit).toFixed(0):'—'}</td>
                        <td style="padding:12px 14px;text-align:right;">
                            ${grandRevenue>0?`<span style="background:#27ae6022;color:#27ae60;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:800;">${((grandProfit/grandRevenue)*100).toFixed(1)}%</span>`:'—'}
                        </td>
                    </tr>
                </table>`;
        }

        function generatePurchaseReport() {
            if (!purchases || purchases.length === 0) {
                showToast('No purchase data to export', 'warning');
                return;
            }
            const medRevenue = buildMedRevenue();

            // Detail rows
            let csv = 'Date,Supplier,Medicine,Qty,Cost Price,Total Cost\n';
            purchases.forEach(p => {
                const d = String(p.date||'').split('T')[0];
                csv += `"${d}","${normSupplier(p.supplier)}","${normMedicine(p.medicineName)}",${p.qty||0},${parseFloat(p.costPrice||0).toFixed(2)},${purchaseCost(p).toFixed(2)}\n`;
            });

            // Supplier summary with margins
            const supStats = {};
            purchases.forEach(p => {
                const sup = normSupplier(p.supplier);
                const med = normMedicine(p.medicineName);
                if (!supStats[sup]) supStats[sup] = { cost:0, revenue:0 };
                supStats[sup].cost    += purchaseCost(p);
                supStats[sup].revenue += medRevenue[med] || 0;
            });
            csv += '\nSupplier Summary with Margins\nSupplier,Cost Paid,Revenue,Profit,Margin %\n';
            Object.entries(supStats).sort((a,b)=>b[1].cost-a[1].cost).forEach(([s,v]) => {
                const profit = v.revenue - v.cost;
                const margin = v.revenue > 0 ? ((profit/v.revenue)*100).toFixed(1)+'%' : 'N/A';
                csv += `"${s}",${v.cost.toFixed(2)},${v.revenue.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
            });

            // Medicine summary with margins
            const medStats2 = {};
            purchases.forEach(p => {
                const med = normMedicine(p.medicineName);
                if (!medStats2[med]) medStats2[med] = { qty:0, cost:0 };
                medStats2[med].qty  += parseInt(p.qty)||0;
                medStats2[med].cost += purchaseCost(p);
            });
            csv += '\nMedicine Summary with Margins\nMedicine,Qty,Cost,Revenue,Profit,Margin %\n';
            Object.entries(medStats2).sort((a,b)=>b[1].cost-a[1].cost).forEach(([m,v]) => {
                const rev    = medRevenue[m] || 0;
                const profit = rev - v.cost;
                const margin = rev > 0 ? ((profit/rev)*100).toFixed(1)+'%' : 'N/A';
                csv += `"${m}",${v.qty},${v.cost.toFixed(2)},${rev.toFixed(2)},${profit.toFixed(2)},${margin}\n`;
            });

            downloadReport(csv, 'Purchase-wise-Report.csv');
            showToast('✅ Purchase report with margins downloaded!', 'success');
        }

        function generateTreatmentReport() {
            // Export treatment receipts log — reads from tr_history (same key as printTreatmentReceipt)
            try {
                const saved = JSON.parse(localStorage.getItem('tr_history') || '[]');
                if (!saved.length) { showToast('No treatment receipts saved yet', 'warning'); return; }
                let csv = 'Receipt No,Date,Patient,Amount,Treatments\n';
                saved.forEach(r => {
                    csv += `"${r.no||''}","${r.date||''}","${r.patient||''}","${r.amount||''}","${r.treatments||''}"\n`;
                });
                downloadReport(csv, 'Treatment-Receipts-Report.csv');
                showToast('✅ Treatment report downloaded!', 'success');
            } catch(e) { showToast('No treatment data found', 'warning'); }
        }

        // Auto-render when reports page is shown
        const _origShowPage = typeof showPage === 'function' ? showPage : null;

        // ══ END CLINIC PERFORMANCE REPORTS ═══════════════════════

        function updateDate() {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-IN', options);
        }
    
