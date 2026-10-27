/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ════════════════════════════════════════
    // EXAMINATION FORM
    // ════════════════════════════════════════
    var _efHistory = JSON.parse(localStorage.getItem('ef_history') || '[]');
    function saveEfHistory(){ localStorage.setItem('ef_history', JSON.stringify(_efHistory)); }

    // Dental chart tooth numbers
    var EF_UPPER = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
    var EF_LOWER = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

    function initDentalChart() {
        ['upper','lower'].forEach(function(arch) {
            var nums  = EF_UPPER;
            if (arch === 'lower') nums = EF_LOWER;
            var numRow  = document.getElementById('ef_'+arch+'_nums');
            var markRow = document.getElementById('ef_'+arch+'_marks');
            if (!numRow || !markRow) return;
            numRow.innerHTML  = nums.map(function(n){ return '<th>'+n+'</th>'; }).join('');
            markRow.innerHTML = nums.map(function(n){
                return '<td><input type="text" class="ef-chart-input" id="ef_tooth_'+n+'" maxlength="4" placeholder="" title="Tooth '+n+'"></td>';
            }).join('');
        });
    }

    function getExamData() {
        var teeth = {};
        EF_UPPER.concat(EF_LOWER).forEach(function(n){
            var el = document.getElementById('ef_tooth_'+n);
            if (el) teeth[n] = el.value.toUpperCase();
        });
        var tps = ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'];
        var checkedTp = tps.filter(function(t){ var el=document.getElementById('ef_tp_'+t); return el&&el.checked; });
        return {
            patient:    document.getElementById('ef_patient').value||'',
            age:        document.getElementById('ef_age').value||'',
            sex:        document.getElementById('ef_sex').value||'',
            date:       document.getElementById('ef_date').value||'',
            doctor:     document.getElementById('ef_doctor').value||'',
            phone:      document.getElementById('ef_phone').value||'',
            swelling:   document.getElementById('ef_swelling').value||'',
            tmj:        document.getElementById('ef_tmj').value||'',
            lymph:      document.getElementById('ef_lymph').value||'',
            oral_hygiene:document.getElementById('ef_oral_hygiene').value||'',
            gingiva:    document.getElementById('ef_gingiva').value||'',
            caries:     document.getElementById('ef_caries').value||'',
            missing_teeth:document.getElementById('ef_missing_teeth').value||'',
            stains:     document.getElementById('ef_stains').value||'',
            calculus:   document.getElementById('ef_calculus').value||'',
            prov_diag:  document.getElementById('ef_prov_diag').value||'',
            final_diag: document.getElementById('ef_final_diag').value||'',
            tp_notes:   document.getElementById('ef_tp_notes').value||'',
            treatments: checkedTp,
            teeth:      teeth,
            savedAt:    new Date().toISOString()
        };
    }

    function loadExamData(d) {
        document.getElementById('ef_patient').value     = d.patient||'';
        document.getElementById('ef_age').value         = d.age||'';
        document.getElementById('ef_sex').value         = d.sex||'';
        document.getElementById('ef_date').value        = d.date||'';
        document.getElementById('ef_doctor').value      = d.doctor||'';
        document.getElementById('ef_phone').value       = d.phone||'';
        document.getElementById('ef_swelling').value    = d.swelling||'';
        document.getElementById('ef_tmj').value         = d.tmj||'';
        document.getElementById('ef_lymph').value       = d.lymph||'';
        document.getElementById('ef_oral_hygiene').value= d.oral_hygiene||'';
        document.getElementById('ef_gingiva').value     = d.gingiva||'';
        document.getElementById('ef_caries').value      = d.caries||'';
        document.getElementById('ef_missing_teeth').value=d.missing_teeth||'';
        document.getElementById('ef_stains').value      = d.stains||'';
        document.getElementById('ef_calculus').value    = d.calculus||'';
        document.getElementById('ef_prov_diag').value   = d.prov_diag||'';
        document.getElementById('ef_final_diag').value  = d.final_diag||'';
        document.getElementById('ef_tp_notes').value    = d.tp_notes||'';
        ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'].forEach(function(t){
            var el=document.getElementById('ef_tp_'+t);
            if(el) el.checked = (d.treatments||[]).includes(t);
        });
        if (d.teeth) {
            EF_UPPER.concat(EF_LOWER).forEach(function(n){
                var el=document.getElementById('ef_tooth_'+n);
                if(el) el.value = d.teeth[n]||'';
            });
        }
    }

    function clearExamForm() {
        ['ef_patient','ef_age','ef_phone','ef_swelling','ef_tmj','ef_lymph',
         'ef_oral_hygiene','ef_gingiva','ef_caries','ef_missing_teeth','ef_stains',
         'ef_calculus','ef_prov_diag','ef_final_diag','ef_tp_notes'].forEach(function(id){
            var el=document.getElementById(id); if(el) el.value='';
        });
        document.getElementById('ef_sex').value='';
        document.getElementById('ef_doctor').value='';
        document.getElementById('ef_date').valueAsDate=new Date();
        ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'].forEach(function(t){
            var el=document.getElementById('ef_tp_'+t); if(el) el.checked=false;
        });
        EF_UPPER.concat(EF_LOWER).forEach(function(n){
            var el=document.getElementById('ef_tooth_'+n); if(el) el.value='';
        });
    }

    function buildExamPrintHTML(d) {
        d = d || getExamData();
        var dateStr = d.date ? new Date(d.date+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '_______________';
        var tpLabels = {scaling:'Scaling',filling:'Filling',crown:'Crown',rct:'Root Canal Treatment',denture:'Denture',extraction:'Extraction',implant:'Implant',braces:'Braces',surgery:'Surgery',other:'Other'};
        var allTp = ['scaling','filling','crown','rct','denture','extraction','implant','braces','surgery','other'];

        var upperCells = EF_UPPER.map(function(n){ return '<th style="border:1.5px solid #999;padding:4px 6px;min-width:30px;background:#f0f4ff;font-size:11px;font-weight:700;text-align:center;">'+n+'</th>'; }).join('');
        var upperMarks = EF_UPPER.map(function(n){ return '<td style="border:1.5px solid #999;padding:4px 6px;min-width:30px;text-align:center;font-size:11px;font-weight:700;color:#c0392b;">'+(d.teeth&&d.teeth[n]?d.teeth[n]:'')+'</td>'; }).join('');
        var lowerCells = EF_LOWER.map(function(n){ return '<th style="border:1.5px solid #999;padding:4px 6px;min-width:30px;background:#f0f4ff;font-size:11px;font-weight:700;text-align:center;">'+n+'</th>'; }).join('');
        var lowerMarks = EF_LOWER.map(function(n){ return '<td style="border:1.5px solid #999;padding:4px 6px;min-width:30px;text-align:center;font-size:11px;font-weight:700;color:#c0392b;">'+(d.teeth&&d.teeth[n]?d.teeth[n]:'')+'</td>'; }).join('');

        var tpRow1 = allTp.slice(0,5).map(function(t){ return '<td style="border:1.5px solid #999;padding:7px;text-align:center;font-size:12px;">'+((d.treatments||[]).includes(t)?'☑':'☐')+' '+tpLabels[t]+'</td>'; }).join('');
        var tpRow2 = allTp.slice(5).map(function(t){ return '<td style="border:1.5px solid #999;padding:7px;text-align:center;font-size:12px;">'+((d.treatments||[]).includes(t)?'☑':'☐')+' '+tpLabels[t]+'</td>'; }).join('');

        var clinicName  = (typeof CONFIG!=='undefined'&&CONFIG.clinicName)  ? CONFIG.clinicName  : 'Sri Sai Speciality Dental Care';
        var clinicPhone = (typeof CONFIG!=='undefined'&&CONFIG.clinicPhone) ? CONFIG.clinicPhone : '9396522492, 8688033072';
        var clinicAddr  = (typeof CONFIG!=='undefined'&&CONFIG.clinicAddress)?CONFIG.clinicAddress: 'TKR College Road, Karmanghat, Hyderabad';

        return '<style>@page{size:A4;margin:14mm}body,*{font-family:"Bookman Old Style","Book Antiqua",Georgia,serif;box-sizing:border-box}body{padding:0;color:#000;font-size:13px}h1{text-align:center;font-size:18px;font-weight:900;letter-spacing:1px}@media print{html,body{margin:0;padding:0}}</style>'+
        '<div style="max-width:720px;margin:0 auto;">'+
        '<h1 style="text-align:center;font-size:24px;font-weight:900;letter-spacing:1px;margin-bottom:4px;">'+clinicName+'</h1>'+
        '<div style="text-align:center;font-size:14px;margin-bottom:4px;">'+clinicAddr+'</div>'+
        '<div style="text-align:center;font-size:14px;margin-bottom:14px;">📞 '+clinicPhone+'</div>'+
        '<hr style="border:2px solid #000;margin-bottom:12px;">'+
        '<h2 style="text-align:center;font-size:15px;font-weight:900;text-decoration:underline;margin-bottom:14px;">EXAMINATION FORM</h2>'+

        // Patient info
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">'+
        '<tr><td style="padding:4px;width:50%;"><strong>Patient:</strong> '+(d.patient||'_________________________')+'</td>'+
        '<td style="padding:4px;"><strong>Date:</strong> '+dateStr+'</td></tr>'+
        '<tr><td style="padding:4px;"><strong>Age/Sex:</strong> '+(d.age||'___')+' / '+(d.sex||'___')+'</td>'+
        '<td style="padding:4px;"><strong>Doctor:</strong> '+(d.doctor||'_________________________')+'</td></tr>'+
        '</table>'+

        // Section 1
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 10px;">1. CLINICAL EXAMINATION</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;">'+
        '<tr>'+
        '<td style="width:50%;vertical-align:top;padding-right:10px;">'+
            '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Extra Oral Examination</th><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Remarks</th></tr></thead>'+
            '<tbody>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">Swelling</td><td style="border:1.5px solid #999;padding:7px;">'+(d.swelling||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">TMJ</td><td style="border:1.5px solid #999;padding:7px;">'+(d.tmj||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:7px;">Lymph Nodes</td><td style="border:1.5px solid #999;padding:7px;">'+(d.lymph||'—')+'</td></tr>'+
            '</tbody></table>'+
        '</td>'+
        '<td style="width:50%;vertical-align:top;">'+
            '<table style="width:100%;border-collapse:collapse;">'+
            '<thead><tr><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Intra Oral Examination</th><th style="border:1.5px solid #999;padding:7px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Remarks</th></tr></thead>'+
            '<tbody>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Oral Hygiene</td><td style="border:1.5px solid #999;padding:6px;">'+(d.oral_hygiene||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Gingiva</td><td style="border:1.5px solid #999;padding:6px;">'+(d.gingiva||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Dental Caries</td><td style="border:1.5px solid #999;padding:6px;">'+(d.caries||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Missing Teeth</td><td style="border:1.5px solid #999;padding:6px;">'+(d.missing_teeth||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Stains</td><td style="border:1.5px solid #999;padding:6px;">'+(d.stains||'—')+'</td></tr>'+
            '<tr><td style="border:1.5px solid #999;padding:6px;">Calculus</td><td style="border:1.5px solid #999;padding:6px;">'+(d.calculus||'—')+'</td></tr>'+
            '</tbody></table>'+
        '</td></tr></table>'+

        // Section 2 - Dental Chart
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">2. DENTAL CHART ADULT</h3>'+
        '<div style="text-align:center;font-weight:700;font-size:12px;margin-bottom:6px;">Upper Arch</div>'+
        '<div style="overflow-x:auto;margin-bottom:10px;"><table style="border-collapse:collapse;margin:0 auto;"><thead><tr>'+upperCells+'</tr></thead><tbody><tr>'+upperMarks+'</tr></tbody></table></div>'+
        '<div style="text-align:center;font-weight:700;font-size:12px;margin-bottom:6px;">Lower Arch</div>'+
        '<div style="overflow-x:auto;margin-bottom:8px;"><table style="border-collapse:collapse;margin:0 auto;"><thead><tr>'+lowerCells+'</tr></thead><tbody><tr>'+lowerMarks+'</tr></tbody></table></div>'+
        '<div style="font-size:11px;color:#555;text-align:center;margin-bottom:14px;">Markings: C = Caries &nbsp; M = Missing &nbsp; RCT = Root Canal &nbsp; CR = Crown &nbsp; IMP = Implant &nbsp; EX = Extraction Advised</div>'+

        // Section 3
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">3. DIAGNOSIS</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;">'+
        '<thead><tr><th style="border:1.5px solid #999;padding:8px;background:#1e3f5a;color:#fff;width:35%;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Diagnosis Type</th><th style="border:1.5px solid #999;padding:8px;background:#1e3f5a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Details</th></tr></thead>'+
        '<tbody>'+
        '<tr><td style="border:1.5px solid #999;padding:8px;">Provisional Diagnosis</td><td style="border:1.5px solid #999;padding:8px;">'+(d.prov_diag||'—')+'</td></tr>'+
        '<tr><td style="border:1.5px solid #999;padding:8px;">Final Diagnosis</td><td style="border:1.5px solid #999;padding:8px;">'+(d.final_diag||'—')+'</td></tr>'+
        '</tbody></table>'+

        // Section 4
        '<h3 style="text-align:center;font-size:13px;font-weight:900;text-decoration:underline;margin:12px 0 8px;">4. TREATMENT PLAN</h3>'+
        '<table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:12px;"><tbody>'+
        '<tr>'+tpRow1+'</tr><tr>'+tpRow2+'</tr>'+
        '</tbody></table>'+
        '<div style="font-size:12px;margin-bottom:14px;padding:4px 0;">*Treatment Notes: '+(d.tp_notes||'___________________________________________')+'</div>'+

        '</div>';
    }

    function printExamForm() {
        var d = getExamData();
        if (!d.patient) { showToast('Enter patient name first','warning'); return; }
        // Save to history
        _efHistory.push(d);
        saveEfHistory();
        renderEfHistory();
        // Sync to Google Sheets
        if (window.CONFIG && CONFIG.apiUrl && !CONFIG.apiUrl.includes('YOUR_WEB_APP')) {
            var p = new URLSearchParams();
            p.append('action','saveExamForm');
            p.append('date',         d.date);
            p.append('patient',      d.patient);
            p.append('age',          d.age);
            p.append('sex',          d.sex);
            p.append('doctor',       d.doctor);
            p.append('phone',        d.phone);
            p.append('swelling',     d.swelling);
            p.append('tmj',          d.tmj);
            p.append('lymph',        d.lymph);
            p.append('oral_hygiene', d.oral_hygiene);
            p.append('gingiva',      d.gingiva);
            p.append('caries',       d.caries);
            p.append('missing_teeth',d.missing_teeth);
            p.append('stains',       d.stains);
            p.append('calculus',     d.calculus);
            p.append('prov_diag',    d.prov_diag);
            p.append('final_diag',   d.final_diag);
            p.append('treatments',   (d.treatments||[]).join(', '));
            p.append('tp_notes',     d.tp_notes);
            p.append('upper_teeth',  EF_UPPER.map(function(n){ return n+':'+(d.teeth[n]||''); }).join(', '));
            p.append('lower_teeth',  EF_LOWER.map(function(n){ return n+':'+(d.teeth[n]||''); }).join(', '));
            fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){ if(res.success) showToast('☁️ Exam form saved to Sheets!','success'); })
                .catch(function(){});
        }
        printBillHtml(buildExamPrintHTML(d));
    }

    function renderEfHistory() {
        var el = document.getElementById('ef_history_list'); if (!el) return;
        if (!_efHistory.length) {
            el.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;font-size:13px;">No exam forms saved yet.</div>';
            return;
        }
        el.innerHTML = _efHistory.slice().reverse().map(function(d, ri) {
            var idx = _efHistory.length - 1 - ri;
            var dateStr = d.date ? new Date(d.date+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
            var tpSummary = (d.treatments||[]).map(function(t){ return t.charAt(0).toUpperCase()+t.slice(1); }).join(', ') || '—';
            return '<div class="ef-hist-item">' +
                '<div class="ef-hist-info">' +
                    '<div class="ef-hist-name">🦷 '+(d.patient||'—')+'</div>' +
                    '<div class="ef-hist-meta">📅 '+dateStr+(d.doctor?' | 👨‍⚕️ '+d.doctor:'')+'</div>' +
                    '<div class="ef-hist-meta">📋 '+tpSummary+'</div>' +
                '</div>' +
                '<div class="ef-hist-btns">' +
                    '<button style="background:#2c5aa0;" onclick="loadEfRecord('+idx+')">✏️ Load</button>' +
                    '<button style="background:#27ae60;" onclick="reprintEfRecord('+idx+')">🖨️ Print</button>' +
                    '<button style="background:#e74c3c;" onclick="deleteEfRecord('+idx+')">🗑️</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function loadEfRecord(idx) {
        loadExamData(_efHistory[idx]);
        window.scrollTo(0,0);
        showToast('✅ Exam form loaded','success');
    }

    function reprintEfRecord(idx) {
        printBillHtml(buildExamPrintHTML(_efHistory[idx]));
    }

    function deleteEfRecord(idx) {
        if (!confirm('Delete this exam form?')) return;
        var rec = _efHistory[idx];
        _efHistory.splice(idx,1);
        saveEfHistory();
        renderEfHistory();
        showToast('🗑️ Exam form deleted', 'success');
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'deleteExamForm');
        p.append('savedAt', rec ? (rec.savedAt||rec.date||'') : '');
        p.append('patientName', rec ? (rec.patientName||rec.patient||'') : '');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if (res.success) showToast('☁️ Removed from Google Sheets', 'success'); else showToast('⚠️ Deleted locally — Sheets sync failed', 'warning'); })
            .catch(function(){ showToast('⚠️ Deleted locally only', 'warning'); });
    }

    function clearExamHistory() {
        if (!confirm('Clear all exam form history?')) return;
        _efHistory = [];
        saveEfHistory();
        renderEfHistory();
    }

    document.addEventListener('DOMContentLoaded', function(){
        setTimeout(function(){
            initDentalChart();
            renderEfHistory();
            var d = document.getElementById('ef_date');
            if (d) d.valueAsDate = new Date();
        }, 200);
    });
    // ════════════════════════════════════════
    // END EXAMINATION FORM
    // ════════════════════════════════════════
    
