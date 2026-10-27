/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Sheets sync helpers ───────────────────────────────────
    function sheetsPost(params, successMsg, failMsg) {
        if (!window.CONFIG || !CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var url = CONFIG.apiUrl + '?' + params.toString();
        fetch(url, { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){ if(res.success) showToast(successMsg,'success'); else showToast(failMsg,'warning'); })
            .catch(function(){ showToast(failMsg,'warning'); });
    }

    // ════════════════════════════════════════
    // PATIENTS
    // ════════════════════════════════════════
    var _patients = JSON.parse(localStorage.getItem('pt_records') || '[]');
    function savePatients(){ localStorage.setItem('pt_records', JSON.stringify(_patients)); }

    function updatePatientStats(){
        var now = new Date(); var ym = now.getFullYear()+'-'+(now.getMonth()+1);
        var due = _patients.reduce(function(s,p){ return s+parseFloat(p.balance||0); }, 0);
        var month = _patients.filter(function(p){ return (p.lastVisit||'').startsWith(now.getFullYear()+'-'); }).length;
        var t=document.getElementById('pt_total'); if(t) t.textContent=_patients.length;
        var m=document.getElementById('pt_month'); if(m) m.textContent=month;
        var d=document.getElementById('pt_due');   if(d) d.textContent='₹'+due.toFixed(0);
    }

    function renderPatientsTable(list){
        list = list || _patients;
        var tbody = document.getElementById('patientsBody');
        var cards = document.getElementById('patientsCards');
        if(!tbody) return;
        if(!list.length){
            tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px;">No patients yet. Click + Add Patient.</td></tr>';
            if(cards) cards.innerHTML='<div style="text-align:center;color:#aaa;padding:30px;">No patients yet.</div>';
            return;
        }
        var statusColor = {Active:'green',Due:'orange','Follow-up':'blue'};
        var __fullList = list; list = __lazySlice('patients', list); // lazy: 50 at a time
        tbody.innerHTML = list.map(function(p,i){
            var sc = statusColor[p.status]||'grey';
            var idx = _patients.indexOf(p);
            return '<tr>' +
                '<td><strong>'+p.name+'</strong>'+(p.age?' <span style="color:#aaa;font-size:12px;">('+p.age+(p.sex?' '+p.sex:'')+')' +'</span>':'')+'</td>'+
                '<td style="white-space:nowrap;">'+( p.phone||'—')+'</td>'+
                '<td style="white-space:nowrap;">'+(p.lastVisit||'—')+'</td>'+
                '<td>'+(p.treatment||'—')+'</td>'+
                '<td style="font-weight:700;color:'+(parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60')+'">₹'+(parseFloat(p.balance||0).toFixed(0))+'</td>'+
                '<td><span class="patient-badge '+sc+'">'+(p.status||'Active')+'</span></td>'+
                '<td style="white-space:nowrap;">' +
                    '<button onclick="sendWaToPatient('+idx+')" style="background:#25d366;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;margin-right:4px;touch-action:manipulation;">📲 WA</button>' +
                    '<button onclick="deletePatient('+idx+')" style="background:#e74c3c;color:#fff;border:none;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;touch-action:manipulation;">🗑️</button>' +
                '</td></tr>';
        }).join('') + __lazyMore('patients', __fullList.length, list.length, 7);
        if(cards){
            cards.innerHTML = list.map(function(p,i){
                var idx = _patients.indexOf(p);
                var sc = statusColor[p.status]||'grey';
                var balColor = parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60';
                return '<div class="m-card" style="border-left-color:'+(parseFloat(p.balance||0)>0?'#e74c3c':'#27ae60')+'">' +
                    '<div class="m-card-row"><div class="m-card-title">'+p.name+'</div>' +
                    '<div style="font-weight:900;color:'+balColor+';">₹'+(parseFloat(p.balance||0).toFixed(0))+'</div></div>' +
                    '<div class="m-card-meta">📞 '+(p.phone||'—')+' &nbsp;|&nbsp; <span class="patient-badge '+sc+'">'+(p.status||'Active')+'</span></div>' +
                    '<div class="m-card-meta">🦷 '+(p.treatment||'—')+(p.alerts?' &nbsp;⚠️ '+p.alerts:'')+'</div>' +
                    '<div class="m-card-actions">' +
                        '<button style="background:#25d366;" onclick="sendWaToPatient('+idx+')">📲 WhatsApp</button>' +
                        '<button style="background:#e74c3c;" onclick="deletePatient('+idx+')">🗑️ Delete</button>' +
                    '</div></div>';
            }).join('') + __lazyMore('patients', __fullList.length, list.length);
        }
        updatePatientStats();
    }

    function filterPatients(){
        var q=(document.getElementById('ptSearch').value||'').toLowerCase();
        renderPatientsTable(q ? _patients.filter(function(p){ return (p.name||'').toLowerCase().includes(q)||(String(p.phone||'')).includes(q); }) : _patients);
    }

    function openAddPatientModal(){
        ['pt_name','pt_phone','pt_age','pt_treatment','pt_alerts'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var s=document.getElementById('pt_sex'); if(s) s.value='';
        var d=document.getElementById('pt_doctor'); if(d) d.value='';
        document.getElementById('addPatientModal').classList.add('active');
    }

    function savePatient(){
        var name=(document.getElementById('pt_name').value||'').trim();
        var phone=(document.getElementById('pt_phone').value||'').trim();
        if(!name){ showToast('Enter patient name','warning'); return; }
        var today = new Date().toISOString().split('T')[0];
        var patient = {
            id: 'PT-'+Date.now(),
            name:name, phone:phone,
            age:document.getElementById('pt_age').value||'',
            sex:document.getElementById('pt_sex').value||'',
            doctor:document.getElementById('pt_doctor').value||'',
            treatment:document.getElementById('pt_treatment').value||'',
            balance:0,
            alerts:document.getElementById('pt_alerts').value||'',
            status:'Active',
            lastVisit:today, addedOn:today
        };
        _patients.push(patient);
        savePatients();
        closeModal('addPatientModal');
        renderPatientsTable();
        showToast('✅ Patient saved!','success');

        // Sync to Google Sheets
        var p = new URLSearchParams();
        p.append('action','savePatient');
        p.append('id', patient.id);
        p.append('name', patient.name);
        p.append('phone', patient.phone);
        p.append('age', patient.age);
        p.append('sex', patient.sex);
        p.append('doctor', patient.doctor);
        p.append('treatment', patient.treatment);
        p.append('balance', patient.balance);
        p.append('alerts', patient.alerts);
        p.append('status', patient.status);
        p.append('lastVisit', patient.lastVisit);
        var syncUrl = CONFIG.apiUrl + '?' + p.toString(); fetch(syncUrl, {method:'GET',redirect:'follow'}).then(function(r){return r.json();}).then(function(res){if(res.success) showToast('Synced to Sheets!','success'); else showToast('Sync failed:'+(res.error||''),'warning');}).catch(function(e){showToast('Error:'+e,'warning');});
    }

    function deletePatient(idx){
        if(!confirm('Delete this patient record?')) return;
        var patient = _patients[idx];
        _patients.splice(idx,1);
        savePatients();
        renderPatientsTable();
        showToast('🗑️ Patient deleted','success');
        // Sync to Sheets
        if (patient && patient.id) {
            var p = new URLSearchParams();
            p.append('action','deletePatient');
            p.append('id', patient.id);
            fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'})
                .then(function(r){return r.json();})
                .then(function(res){ if(res.success) showToast('☁️ Patient removed from Sheets','success'); else showToast('⚠️ Deleted locally only','warning'); })
                .catch(function(){ showToast('⚠️ Deleted locally only','warning'); });
        }
    }

    function sendWaToPatient(idx){
        var p=_patients[idx]; if(!p) return;
        var phone=(String(p.phone||'')).replace(/[^\d]/g,'');
        if(!phone){ showToast('No phone number for this patient','warning'); return; }
        if(phone.length===10) phone='91'+phone;
        var msg='*🦷 Sri Sai Speciality Dental Care*\n\nHello *'+p.name+'*! 😊\n\n';
        if(parseFloat(p.balance||0)>0){
            msg+='💰 You have an outstanding balance of *₹'+parseFloat(p.balance).toFixed(0)+'*.\nKindly settle before your next visit.\n\n';
        }
        msg+='Thank you for choosing Sri Sai Speciality Dental Care! 🙏\n📞 8688033072 | 9396522492';
        openWhatsApp(phone, msg);
    }

    // ════════════════════════════════════════
    // APPOINTMENTS
    // ════════════════════════════════════════
    var _appointments = JSON.parse(localStorage.getItem('appointments') || '[]');
    // Migrate any appointments with raw/broken times to proper slot format
    (function(){
        function _fixTime(t){
            if(!t && t!==0) return t;
            var s = String(t).trim();
            if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) return s.toUpperCase();
            var h, m;
            // Sheets decimal fraction e.g. 0.4375 = 10:30 AM
            var num = parseFloat(s);
            if (!isNaN(num) && num >= 0 && num < 1) {
                var totalMins = Math.round(num * 24 * 60);
                h = Math.floor(totalMins / 60); m = totalMins % 60;
            }
            if (h === undefined && s.includes('T')) {
                var d = new Date(s); if (!isNaN(d)) { h = d.getUTCHours(); m = d.getUTCMinutes(); }
            }
            if (h === undefined && /^\d{1,2}:\d{2}$/.test(s)) {
                var p = s.split(':'); h = parseInt(p[0]); m = parseInt(p[1]);
            }
            if (h === undefined) return t;
            var sM = m < 15 ? 0 : m < 45 ? 30 : 0;
            var sH = m >= 45 ? h + 1 : h;
            var ap = sH < 12 ? 'AM' : 'PM'; var h12 = sH % 12 || 12;
            return ('0' + h12).slice(-2) + ':' + (sM === 0 ? '00' : '30') + ' ' + ap;
        }
        var changed = false;
        _appointments.forEach(function(a){ var f = _fixTime(a.time); if(f !== a.time){ a.time = f; changed = true; } });
        if (changed) localStorage.setItem('appointments', JSON.stringify(_appointments));
    })();
    function saveAppts(){ localStorage.setItem('appointments', JSON.stringify(_appointments)); }

    function apptChangeDay(dir){
        var d=document.getElementById('appt_date');
        if(!d) return;
        var cur=d.value?new Date(d.value):new Date();
        cur.setDate(cur.getDate()+dir);
        d.value=cur.toISOString().split('T')[0];
        renderAppointments();
    }

    function renderAppointments(){
        var dateEl=document.getElementById('appt_date');
        var selDate=dateEl?dateEl.value:new Date().toISOString().split('T')[0];
        var label=document.getElementById('appt_dateLabel');
        if(label) label.textContent=new Date(selDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        var dayAppts=_appointments.filter(function(a){ return a.date===selDate; });
        var morning=['09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM','01:00 PM','01:30 PM'];
        var afternoon=['02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM','04:30 PM','05:00 PM','05:30 PM','06:00 PM','06:30 PM','07:00 PM','07:30 PM','08:00 PM'];
        var allSlots = morning.concat(afternoon);
        var confirmed=0,cancelled=0;
        function renderSlots(times,containerId){
            var html='';
            times.forEach(function(time){
                var appt=dayAppts.find(function(a){ return a.time===time; });
                if(appt){
                    var cls=appt.status==='Cancelled'?'cancelled':'booked';
                    var bc=appt.status==='Cancelled'?'red':appt.reason?'green':'blue';
                    if(appt.status!=='Cancelled') confirmed++;
                    else cancelled++;
                    html+='<div class="appt-slot '+cls+'" onclick="toggleApptStatus(\''+appt.id+'\')">'+
                        '<span class="appt-time">'+time+'</span>'+
                        '<span class="appt-name">'+appt.patient+'</span>'+
                        (appt.reason?'<span class="appt-badge '+bc+'">'+appt.reason+'</span>':'')+
                        '<button onclick="event.stopPropagation();deleteAppt(\''+appt.id+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
                        '</div>';
                } else {
                    html+='<div class="appt-slot free" onclick="quickBookSlot(\''+selDate+'\',\''+time+'\')">'+
                        '<span class="appt-time">'+time+'</span>'+
                        '<span class="appt-name" style="color:#aaa;">Available — tap to book</span>'+
                        '</div>';
                }
            });
            var el=document.getElementById(containerId); if(el) el.innerHTML=html;
        }
        renderSlots(morning,'appt_morning');
        renderSlots(afternoon,'appt_afternoon');
        // Show appointments whose time doesn't match any standard slot (custom / imported times)
        var unmatched = dayAppts.filter(function(a){ return allSlots.indexOf(a.time) === -1; });
        if (unmatched.length) {
            var extraHtml = '<div style="margin-top:10px;padding:10px 0 4px;font-size:12px;font-weight:700;color:#e67e22;">⚠️ Custom-time appointments (not in standard slots):</div>';
            unmatched.forEach(function(appt){
                var cls=appt.status==='Cancelled'?'cancelled':'booked';
                var bc=appt.status==='Cancelled'?'red':appt.reason?'green':'blue';
                if(appt.status!=='Cancelled') confirmed++;
                else cancelled++;
                extraHtml+='<div class="appt-slot '+cls+'" onclick="toggleApptStatus(\''+appt.id+'\')">'+
                    '<span class="appt-time">'+appt.time+'</span>'+
                    '<span class="appt-name">'+appt.patient+'</span>'+
                    (appt.reason?'<span class="appt-badge '+bc+'">'+appt.reason+'</span>':'')+
                    '<button onclick="event.stopPropagation();deleteAppt(\''+appt.id+'\')" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;touch-action:manipulation;">×</button>'+
                    '</div>';
            });
            var mEl = document.getElementById('appt_morning');
            if (mEl) mEl.innerHTML += extraHtml;
        }
        var avail=allSlots.length-dayAppts.filter(function(a){return a.status!=='Cancelled';}).length;
        var ec=document.getElementById('appt_confirmed'); if(ec) ec.textContent=confirmed;
        var ea=document.getElementById('appt_available'); if(ea) ea.textContent=avail;
        var ecan=document.getElementById('appt_cancelled'); if(ecan) ecan.textContent=cancelled;
        renderWaTodayList();
    }

    function openAddApptModal(){
        ['appt_patient','appt_phone','appt_reason'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var d=document.getElementById('appt_bookDate');
        var cd=document.getElementById('appt_date');
        if(d) d.value=cd?cd.value:new Date().toISOString().split('T')[0];
        var t=document.getElementById('appt_time'); if(t) t.value='';
        var dr=document.getElementById('appt_doctor'); if(dr) dr.value='';
        document.getElementById('addApptModal').classList.add('active');
    }

    function quickBookSlot(date,time){
        openAddApptModal();
        var d=document.getElementById('appt_bookDate'); if(d) d.value=date;
        var t=document.getElementById('appt_time'); if(t) t.value=time;
    }

    function saveAppointment(){
        var patient=(document.getElementById('appt_patient').value||'').trim();
        var time=document.getElementById('appt_time').value;
        var date=document.getElementById('appt_bookDate').value;
        if(!patient||!time||!date){ showToast('Fill patient name, date and time','warning'); return; }
        var existing=_appointments.find(function(a){ return a.date===date&&a.time===time&&a.status!=='Cancelled'; });
        if(existing){ showToast('That slot is already booked!','warning'); return; }
        var appt = {
            id:'A'+Date.now(),
            patient:patient,
            phone:document.getElementById('appt_phone').value||'',
            date:date, time:time,
            reason:document.getElementById('appt_reason').value||'',
            doctor:document.getElementById('appt_doctor').value||'',
            status:'Confirmed',
            bookedAt:new Date().toISOString()
        };
        _appointments.push(appt);
        saveAppts();
        closeModal('addApptModal');
        renderAppointments();
        showToast('✅ Appointment booked!','success');

        // Show WA popup if patient has a phone number
        if (appt.phone && String(appt.phone).replace(/[^\d]/g,'').length >= 10) {
            openWaBookingPopup(appt);
        }

        // Sync to Google Sheets
        var p = new URLSearchParams();
        p.append('action','saveAppointment');
        p.append('id', appt.id);
        p.append('patient', appt.patient);
        p.append('phone', appt.phone);
        p.append('date', appt.date);
        p.append('time', appt.time);
        p.append('reason', appt.reason);
        p.append('doctor', appt.doctor);
        p.append('status', appt.status);
        p.append('bookedAt', appt.bookedAt);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Appointment synced!','success'); else showToast('⚠️ Appt saved locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    function toggleApptStatus(id){
        var a=_appointments.find(function(a){ return a.id===id; }); if(!a) return;
        a.status=a.status==='Cancelled'?'Confirmed':'Cancelled';
        saveAppts(); renderAppointments();
        showToast(a.status==='Confirmed'?'✅ Restored':'❌ Cancelled','success');
        // Sync status to Sheets
        var p = new URLSearchParams();
        p.append('action','updateAppointmentStatus');
        p.append('id', a.id);
        p.append('status', a.status);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Status updated in Sheets','success'); else showToast('⚠️ Updated locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    function deleteAppt(id){
        if(!confirm('Delete this appointment?')) return;
        _appointments=_appointments.filter(function(a){ return a.id!==id; });
        saveAppts(); renderAppointments();
        showToast('🗑️ Appointment deleted','success');
        // Sync to Sheets
        var p = new URLSearchParams();
        p.append('action','deleteAppointment');
        p.append('id', id);
        fetch(CONFIG.apiUrl + '?' + p.toString(), {method:'GET', redirect:'follow'}).then(function(r){return r.json();}).then(function(res){ if(res.success) showToast('☁️ Removed from Sheets','success'); else showToast('⚠️ Deleted locally only','warning'); }).catch(function(){ showToast('⚠️ Sync error','warning'); });
    }

    // ════════════════════════════════════════
    // WHATSAPP REMINDERS
    // ════════════════════════════════════════
    var _waSentCount = parseInt(localStorage.getItem('wa_sent_today')||'0');
    var _waSentDate  = localStorage.getItem('wa_sent_date')||'';

    function updateWaStats(){
        var today=new Date().toISOString().split('T')[0];
        if(_waSentDate!==today){ _waSentCount=0; _waSentDate=today; localStorage.setItem('wa_sent_date',today); localStorage.setItem('wa_sent_today','0'); }
        var todayAppts=_appointments.filter(function(a){ return a.date===today&&a.status!=='Cancelled'; });
        var duePats=_patients.filter(function(p){ return parseFloat(p.balance||0)>0; });
        var ws=document.getElementById('wa_sent'); if(ws) ws.textContent=_waSentCount;
        var wa=document.getElementById('wa_appts'); if(wa) wa.textContent=todayAppts.length;
        var wd=document.getElementById('wa_due');   if(wd) wd.textContent=duePats.length;
    }

    function updateWaPreview(){
        var tmpl  = document.getElementById('wa_template').value;
        var name  = (document.getElementById('wa_patName').value||'').trim() || '{name}';
        var extra = document.getElementById('wa_extra_fields');
        var prev  = document.getElementById('wa_preview_text');

        // Build extra fields HTML
        var extraHtml = '';
        if (tmpl === 'reminder24' || tmpl === 'reminder1h') {
            extraHtml =
                '<div style="background:#fff8e1;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#e67e22;margin-bottom:8px;">Fill appointment details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Appointment Time *</label>' +
                '<input type="text" id="wa_appt_time" placeholder="e.g. 10:30 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Treatment / Reason</label>' +
                '<input type="text" id="wa_appt_reason" placeholder="e.g. Scaling" oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_appt_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div>';
        } else if (tmpl === 'reschedule') {
            extraHtml =
                '<div style="background:#f5eef8;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#9b59b6;margin-bottom:8px;">Fill reschedule details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_rsch_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div>' +
                '<div><label style="font-size:12px;">Original Time *</label>' +
                '<input type="text" id="wa_rsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '</div>' +
                '<div><label style="font-size:12px;">Suggested New Date (optional)</label>' +
                '<input type="text" id="wa_rsch_newdate" placeholder="e.g. Tomorrow 27 May at 10 AM" oninput="refreshWaMsg()"></div></div>';
        } else if (tmpl === 'confirm') {
            extraHtml =
                '<div style="background:#e8f8ee;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#27ae60;margin-bottom:8px;">Fill booking details:</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">Date</label><input type="date" id="wa_conf_date" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Time *</label><input type="text" id="wa_conf_time" placeholder="e.g. 10:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_conf_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'payment') {
            extraHtml =
                '<div><label>Balance Amount (Rs.)</label>' +
                '<input type="number" id="wa_pay_amount" placeholder="e.g. 500" inputmode="decimal" oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'followup') {
            extraHtml =
                '<div><label>Treatment Done</label>' +
                '<input type="text" id="wa_fu_treatment" placeholder="e.g. Root Canal" oninput="refreshWaMsg()"></div>';
        } else if (tmpl === 'patReschedule') {
            extraHtml =
                '<div style="background:#e8f8f5;border-radius:8px;padding:12px;margin-bottom:4px;">' +
                '<div style="font-size:12px;font-weight:700;color:#16a085;margin-bottom:8px;">📅 New appointment details (after patient request):</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" class="wa-quick-grid">' +
                '<div><label style="font-size:12px;">New Date</label><input type="date" id="wa_prsch_date" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">New Time *</label><input type="text" id="wa_prsch_time" placeholder="e.g. 11:00 AM" style="font-size:16px;" oninput="refreshWaMsg()"></div>' +
                '<div><label style="font-size:12px;">Doctor</label>' +
                '<select id="wa_prsch_doctor" onchange="refreshWaMsg()">' +
                '<option value="Dr. T Sai Vakula">Dr. T Sai Vakula</option>' +
                '<option value="Dr. T Venkat Rao">Dr. T Venkat Rao</option>' +
                '</select></div></div></div>';
        } else if (tmpl === 'custom') {
            extraHtml =
                '<div><label>Your Message</label>' +
                '<textarea id="wa_custom_msg" rows="4" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;" placeholder="Type your message here..." oninput="refreshWaMsg()"></textarea></div>';
        }
        if (extra) extra.innerHTML = extraHtml;
        // Immediately refresh message after DOM update
        setTimeout(refreshWaMsg, 10);
    }

    function refreshWaMsg() {
        var tmpl   = document.getElementById('wa_template').value;
        var name   = (document.getElementById('wa_patName').value||'').trim() || '{name}';
        var prev   = document.getElementById('wa_preview_text');
        var g = function(id){ var e=document.getElementById(id); return e?e.value:''; };

        var time    = g('wa_appt_time')    || '________';
        var reason  = g('wa_appt_reason');
        var doctor  = g('wa_appt_doctor')  || 'Dr. T Sai Vakula';
        var rschDoc = g('wa_rsch_doctor')  || 'Dr. T Sai Vakula';
        var rschTim = g('wa_rsch_time')    || '________';
        var rschNew = g('wa_rsch_newdate');
        var confDate= g('wa_conf_date');
        var confTime= g('wa_conf_time')    || '________';
        var confDoc = g('wa_conf_doctor')  || 'Dr. T Sai Vakula';
        var payAmt  = g('wa_pay_amount')   || '________';
        var fuTreat = g('wa_fu_treatment') || '________';
        var prschDate = g('wa_prsch_date');
        var prschTime = g('wa_prsch_time') || '________';
        var prschDoc  = g('wa_prsch_doctor') || 'Dr. T Sai Vakula';
        var confDateStr = confDate
            ? new Date(confDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '________';
        var prschDateStr = prschDate
            ? new Date(prschDate+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '________';

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        var msgs = {
            reminder24:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏',

            reminder1h:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊',

            reschedule:
                C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '⚠️ *Important Notice*\n\n' +
                'We regret that *' + rschDoc + '* is *unavailable today*\n' +
                'for your *' + rschTim + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                (rschNew ? '📅 *Suggested:* ' + rschNew + '\n\n' : '') +
                'Please call us to reschedule:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. 🙏\n' +
                '_Sri Sai Speciality Dental Care_',

            confirm:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '✅ *Appointment Confirmed!*\n\n' +
                '📅 *Date:* ' + confDateStr + '\n' +
                '🕐 *Time:* ' + confTime + '\n' +
                '👨‍⚕️ *Doctor:* ' + confDoc + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you!\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷',

            payment:
                C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '💰 *Payment Reminder*\n\n' +
                'Outstanding balance: *₹' + payAmt + '*\n\n' +
                'Kindly settle before your next visit.\n\n' +
                PH + '\n' +
                'Thank you! 😊',

            followup:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '💙 *Follow-up Check*\n\n' +
                'Hope you are recovering well\n' +
                'after your *' + fuTreat + '*.\n\n' +
                'Call us for any concerns.\n\n' +
                PH + '\n' +
                '_We care about your smile!_ 🦷',

            patReschedule:
                C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '📅 *Reschedule Confirmed!*\n\n' +
                'We have received your reschedule request.\n' +
                'Your new appointment is confirmed:\n\n' +
                '📅 *Date:* ' + prschDateStr + '\n' +
                '🕐 *Time:* ' + prschTime + '\n' +
                '👨‍⚕️ *Doctor:* ' + prschDoc + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷',

            custom: g('wa_custom_msg')
        };

        // ── Use custom template if saved, else use default ──────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmpl) : null;
        if (customTmpl && tmpl !== 'custom') {
            // Replace placeholders with actual values
            var msg = customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   confTime !== '________' ? confTime : (time !== '________' ? time : prschTime))
                .replace(/\{date\}/g,   confDateStr !== '________' ? confDateStr : prschDateStr)
                .replace(/\{doctor\}/g, confDoc || doctor || prschDoc)
                .replace(/\{reason\}/g, reason || '');
            if (prev) prev.value = msg;
        } else {
            if (prev) prev.value = msgs[tmpl] || '';
        }
    }

    function sendWaReminder(){
        var phone=(document.getElementById('wa_patPhone').value||'').replace(/[^\d]/g,'');
        if(!phone){ showToast('Enter phone number','warning'); return; }
        if(phone.length===10) phone='91'+phone;
        var tmpl=document.getElementById('wa_template').value;
        var msg=tmpl==='custom'
            ? (document.getElementById('wa_custom_msg')?document.getElementById('wa_custom_msg').value:'')
            : document.getElementById('wa_preview_text').value;
        if(!msg.trim()){ showToast('Message is empty','warning'); return; }
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
    }

    function renderWaTodayList(){
        var el=document.getElementById('wa_today_list'); if(!el) return;
        var today=new Date().toISOString().split('T')[0];
        var todayAppts=_appointments.filter(function(a){ return a.date===today&&a.status!=='Cancelled'; });
        if(!todayAppts.length){
            el.innerHTML='<div style="text-align:center;color:#aaa;padding:20px;">No appointments today.</div>';
            return;
        }
        el.innerHTML=todayAppts.map(function(a){
            var hasPhone = !!(String(a.phone||'')).replace(/[^\d]/g,'');
            var btnStyle = 'padding:7px 10px;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;touch-action:manipulation;color:#fff;white-space:nowrap;';
            return '<div style="border:1px solid #f0f0f0;border-radius:10px;padding:12px;margin-bottom:8px;background:#fafafa;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">' +
                    '<div>' +
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;">'+a.patient+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:2px;">'+a.time+(a.reason?' — '+a.reason:'')+(a.doctor?' | '+a.doctor:'')+'</div>' +
                        (!hasPhone?'<div style="font-size:11px;color:#e74c3c;margin-top:2px;">⚠️ No phone saved</div>':'') +
                    '</div>' +
                    '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                        '<button style="'+btnStyle+'background:#e67e22;" onclick="sendApptWaTemplate(\''+a.id+'\',\'24h\')">⏰ 24h</button>' +
                        '<button style="'+btnStyle+'background:#e74c3c;" onclick="sendApptWaTemplate(\''+a.id+'\',\'1h\')">🔔 1h</button>' +
                        '<button style="'+btnStyle+'background:#9b59b6;" onclick="sendApptWaTemplate(\''+a.id+'\',\'reschedule\')">🔄 Reschedule</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function buildApptMsg(a, type) {
        var name   = a.patient || 'Patient';
        var time   = a.time   || '—';
        var reason = a.reason || '';
        var doctor = a.doctor || 'our doctor';
        var dateStr = a.date
            ? new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '—';

        // Map type codes to template keys
        var tmplKey = type === '24h' ? 'reminder24' : type === '1h' ? 'reminder1h' : type;

        // ── Check custom template first ──────────────────────────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmplKey) : null;
        if (customTmpl) {
            return customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   time)
                .replace(/\{date\}/g,   dateStr)
                .replace(/\{doctor\}/g, doctor)
                .replace(/\{reason\}/g, reason);
        }

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        if (type === '24h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏';
        }
        if (type === '1h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊';
        }
        if (type === 'reschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '⚠️ *Important Notice*\n\n' +
                'We regret that *' + doctor + '* is *unavailable today*\n' +
                'for your *' + time + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                'Please call us to reschedule:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. 🙏\n' +
                '_Sri Sai Speciality Dental Care_';
        }
        return '';
    }

    function sendApptWaTemplate(id, type) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if(!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number for '+a.patient+'. Add in Patients page.','warning'); return; }
        var msg = buildApptMsg(a, type);
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('✅ Message copied! Opening WhatsApp for '+a.patient,'success');
    }

    function sendAllReminders(type) {
        var today = new Date().toISOString().split('T')[0];
        var appts = (_appointments||[]).filter(function(a){ return a.date===today&&a.status!=='Cancelled'&&a.phone; });
        if (!appts.length) { showToast('No appointments with phone numbers today','warning'); return; }
        var label = type==='24h'?'24-hour':'1-hour';
        if (!confirm('Send '+label+' reminders to all '+appts.length+' patients today?')) return;
        var delay = 0;
        appts.forEach(function(a){
            setTimeout(function(){
                var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
                if (phone.length===10) phone='91'+phone;
                var msg = buildApptMsg(a, type);
                openWhatsApp(phone, msg);
                _waSentCount++;
            }, delay);
            delay += 1500; // 1.5s gap between each to avoid spam detection
        });
        localStorage.setItem('wa_sent_today',_waSentCount+appts.length);
        localStorage.setItem('wa_sent_date',today);
        setTimeout(updateWaStats, 500);
        showToast('✅ Sending reminders to '+appts.length+' patients...','success');
    }

    // ═══════════════════════════════════════════════════
    // WA BOOKING POPUP — auto-open after appointment saved
    // ═══════════════════════════════════════════════════
    var _wabpAppt = null;

    function openWaBookingPopup(appt) {
        _wabpAppt = appt;
        var dateStr = appt.date
            ? new Date(appt.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '';
        var el = document.getElementById('wabp_patinfo');
        if (el) el.textContent = (appt.patient||'') + (dateStr?' | '+dateStr:'') + (appt.time?' at '+appt.time:'') + (appt.phone?' | '+appt.phone:'');
        document.getElementById('wabp_template').value = 'confirm';
        updateWabpPreview();
        document.getElementById('waBookingPopup').classList.add('active');
    }

    function buildWabpMsg(tmpl, appt) {
        var name   = appt.patient || 'Patient';
        var time   = appt.time   || '—';
        var reason = appt.reason || '';
        var doctor = appt.doctor || 'our doctor';
        var dateStr = appt.date
            ? new Date(appt.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
            : '—';

        // ── Check custom template first ──────────────────────────────────
        var customTmpl = (typeof _getCustomTmpl === 'function') ? _getCustomTmpl(tmpl) : null;
        if (customTmpl) {
            return customTmpl
                .replace(/\{name\}/g,   name)
                .replace(/\{time\}/g,   time)
                .replace(/\{date\}/g,   dateStr)
                .replace(/\{doctor\}/g, doctor)
                .replace(/\{reason\}/g, reason);
        }

        var C  = '🦷 *Sri Sai Speciality Dental Care*';
        var PH = '📞 *8688033072 | 9396522492*';

        if (tmpl === 'confirm') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '✅ *Appointment Confirmed!*\n\n' +
                '📅 *Date:* ' + dateStr + '\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷';
        }
        if (tmpl === 'reminder24') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '⏰ *Appointment Reminder – Tomorrow*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive *5 minutes early*.\n' +
                'Reply *YES* to confirm or call us to reschedule.\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🙏';
        }
        if (tmpl === 'reminder1h') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '🔔 *Your appointment is in 1 HOUR!*\n\n' +
                '🕐 *Time:* ' + time + '\n' +
                (reason ? '🦷 *Treatment:* ' + reason + '\n' : '') +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please start heading now. 🚗\n\n' +
                PH + '\n' +
                '_See you soon!_ 😊';
        }
        if (tmpl === 'followup') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '💙 *Follow-up Check*\n\n' +
                'Hope you are recovering well' + (reason ? ' after your *' + reason + '*' : '') + '.\n\n' +
                'Call us for any concerns.\n\n' +
                PH + '\n' +
                '_We care about your smile!_ 🦷';
        }
        if (tmpl === 'reschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! \uD83D\uDE4F\n\n' +
                '\u26A0\uFE0F *Important Notice*\n\n' +
                'We regret that *' + doctor + '* is *unavailable today*\n' +
                'for your *' + time + '* appointment.\n\n' +
                'We sincerely apologize for the inconvenience.\n\n' +
                'Please call us to reschedule at your convenience:\n' +
                PH + '\n\n' +
                'Thank you for your understanding. \uD83D\uDE4F\n' +
                '_Sri Sai Speciality Dental Care_';
        }
        if (tmpl === 'patReschedule') {
            return C + '\n\n' +
                'Hello *' + name + '*! 😊\n\n' +
                '📅 *Reschedule Confirmed!*\n\n' +
                'We have received your reschedule request.\n' +
                'Your new appointment is confirmed:\n\n' +
                '📅 *Date:* ' + dateStr + '\n' +
                '🕐 *Time:* ' + time + '\n' +
                '👨‍⚕️ *Doctor:* ' + doctor + '\n\n' +
                'Please arrive 5 minutes early.\n' +
                'We look forward to seeing you! 😊\n\n' +
                PH + '\n' +
                '_Sri Sai Speciality Dental Care_ 🦷';
        }
        if (tmpl === 'payment') {
            return C + '\n\n' +
                'Hello *' + name + '*! 🙏\n\n' +
                '💰 *Payment Reminder*\n\n' +
                'You have an outstanding balance at Sri Sai Speciality Dental Care.\n' +
                'Kindly settle before your next visit.\n\n' +
                PH + '\n' +
                'Thank you! 😊';
        }
        return '';
    }

    function updateWabpPreview() {
        var tmpl = document.getElementById('wabp_template').value;
        var ta   = document.getElementById('wabp_msg');
        if (!ta || !_wabpAppt) return;
        if (tmpl === 'custom') {
            ta.value = '';
            ta.placeholder = 'Type your own message here...';
        } else {
            ta.value = buildWabpMsg(tmpl, _wabpAppt);
        }
    }

    function sendWabpMsg() {
        if (!_wabpAppt) return;
        var phone = (String(_wabpAppt.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved for this patient','warning'); return; }
        var msg = (document.getElementById('wabp_msg').value||'').trim();
        if (!msg) { showToast('Message is empty — type something first','warning'); return; }
        closeModal('waBookingPopup');
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
    }

    // ═══════════════════════════════════════════════════
    // WA ALL APPOINTMENTS LIST
    // ═══════════════════════════════════════════════════
    function renderWaAllAppts() {
        var el = document.getElementById('wa_all_appts_list'); if (!el) return;
        var search  = (document.getElementById('wa_appt_search')||{value:''}).value.toLowerCase().trim();
        var filter  = (document.getElementById('wa_appt_filter')||{value:'all'}).value;
        var today   = new Date().toISOString().split('T')[0];

        var list = (_appointments||[]).slice().sort(function(a,b){ return b.date>a.date?1:b.date<a.date?-1:0; });

        list = list.filter(function(a){
            if (filter==='today')    return a.date===today;
            if (filter==='upcoming') return a.date>today;
            if (filter==='past')     return a.date<today;
            return true;
        });

        if (search) {
            list = list.filter(function(a){
                return (a.patient||'').toLowerCase().includes(search) ||
                       (String(a.phone||'')).includes(search) ||
                       (a.reason||'').toLowerCase().includes(search);
            });
        }

        if (!list.length) {
            el.innerHTML = '<div style="text-align:center;color:#aaa;padding:20px;">No appointments found.</div>';
            return;
        }

        el.innerHTML = list.map(function(a) {
            var hasPhone = !!(String(a.phone||'')).replace(/[^\d]/g,'');
            var dateStr = a.date ? new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}) : '—';
            var isToday = a.date===today;
            var isPast  = a.date<today;
            var borderColor = a.status==='Cancelled'?'#e74c3c': isToday?'#25d366': isPast?'#bbb':'#2c5aa0';
            var bgColor = a.status==='Cancelled'?'#fff5f5': isToday?'#f0fff4': isPast?'#f8f8f8':'#f0f4ff';
            var statusBadge = a.status==='Cancelled'
                ? '<span style="font-size:10px;background:#fee;color:#e74c3c;border-radius:4px;padding:1px 6px;font-weight:700;">❌ Cancelled</span>'
                : isToday ? '<span style="font-size:10px;background:#d4edda;color:#155724;border-radius:4px;padding:1px 6px;font-weight:700;">📅 Today</span>'
                : isPast  ? '<span style="font-size:10px;background:#e2e3e5;color:#383d41;border-radius:4px;padding:1px 6px;font-weight:700;">Past</span>'
                :           '<span style="font-size:10px;background:#d1ecf1;color:#0c5460;border-radius:4px;padding:1px 6px;font-weight:700;">⏳ Upcoming</span>';

            var safeId = a.id.replace(/'/g,"\\'");

            return '<div onclick="waFillFromAppt(\''+safeId+'\')" style="border:1.5px solid '+borderColor+';border-radius:10px;padding:11px 12px;margin-bottom:8px;background:'+bgColor+';cursor:pointer;">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-weight:700;font-size:14px;color:#1e3f5a;margin-bottom:2px;">'+a.patient+' '+statusBadge+'</div>' +
                        '<div style="font-size:12px;color:#555;">📅 '+dateStr+' &nbsp;🕐 '+a.time+(a.reason?' &nbsp;🦷 '+a.reason:'')+'</div>' +
                        '<div style="font-size:12px;color:#777;margin-top:1px;">'+(a.doctor?'👨‍⚕️ '+a.doctor+' &nbsp;':'')+(!hasPhone?'<span style="color:#e74c3c;">⚠️ No phone</span>':'📞 '+a.phone)+'</div>' +
                    '</div>' +
                    '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;max-width:120px;" onclick="event.stopPropagation();">' +
                        (hasPhone ?
                            '<button onclick="waQuickSend(\''+safeId+'\',\'confirm\')" style="padding:5px 9px;background:#27ae60;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✅ Confirm</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reminder24\')" style="padding:5px 9px;background:#e67e22;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">⏰ 24h</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reminder1h\')" style="padding:5px 9px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔔 1h</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'reschedule\')" style="padding:5px 9px;background:#9b59b6;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🔄 Reschedule</button>' +
                            '<button onclick="waQuickSend(\''+safeId+'\',\'patReschedule\')" style="padding:5px 9px;background:#16a085;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📅 Pat.Rsch</button>' +
                            '<button onclick="waOpenPopupForAppt(\''+safeId+'\')" style="padding:5px 9px;background:#2c5aa0;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">✏️ Custom</button>' +
                            '<button onclick="sendClinicLocation(\''+safeId+'\')" style="padding:5px 9px;background:#1abc9c;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">📍 Location</button>'
                        : '') +
                        '<button onclick="deleteAppointmentFromWa(\''+safeId+'\')" style="padding:5px 9px;background:#c0392b;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;touch-action:manipulation;width:100%;">🗑️ Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // Fill Quick Send form from appointment card tap
    function waFillFromAppt(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var nameEl  = document.getElementById('wa_patName');
        var phoneEl = document.getElementById('wa_patPhone');
        if (nameEl)  nameEl.value  = a.patient||'';
        if (phoneEl) phoneEl.value = a.phone||'';
        var tmplEl = document.getElementById('wa_template');
        if (tmplEl) { tmplEl.value='confirm'; updateWaPreview(); }
        setTimeout(function(){
            var df = document.getElementById('wa_conf_date');  if(df) df.value = a.date||'';
            var tf = document.getElementById('wa_conf_time');  if(tf) tf.value = a.time||'';
            var dc = document.getElementById('wa_conf_doctor');if(dc) dc.value = a.doctor||'Dr. T Sai Vakula';
            refreshWaMsg();
        }, 50);
        var qsEl = document.getElementById('wa_patName');
        if (qsEl) qsEl.scrollIntoView({behavior:'smooth',block:'center'});
        showToast('✅ Patient details filled in Quick Send!','success');
    }

    // Open popup for custom message for any appointment
    function waOpenPopupForAppt(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        openWaBookingPopup(a);
    }

    // Delete appointment from WA page
    function deleteAppointmentFromWa(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; });
        if (!a) return;
        var label = a.patient + (a.date ? ' (' + new Date(a.date+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ')' : '');
        if (!confirm('🗑️ Delete appointment for ' + label + '?\n\nThis cannot be undone.')) return;
        _appointments = (_appointments||[]).filter(function(x){ return x.id!==id; });
        if (typeof saveAppts === 'function') saveAppts();
        else localStorage.setItem('appointments', JSON.stringify(_appointments));
        renderWaTodayList();
        renderWaAllAppts();
        if (typeof renderAppointments === 'function') renderAppointments();
        if (typeof renderDashboard === 'function') renderDashboard();
        showToast('🗑️ Deleting appointment...', 'info');
        // Sync deletion to Google Sheets
        var p = new URLSearchParams();
        p.append('action', 'deleteAppointment');
        p.append('id', id);
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){
                if (res.success) showToast('☁️ Deleted from Google Sheets too!', 'success');
                else showToast('⚠️ Deleted locally — Sheets sync failed: ' + (res.error||''), 'warning');
            })
            .catch(function(e){ showToast('⚠️ Deleted locally only — no internet?', 'warning'); });
    }

    // Quick send directly from appointment list
    function waQuickSend(id, tmpl) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved','warning'); return; }
        _wabpAppt = a;
        var msg = buildWabpMsg(tmpl, a);
        _waSentCount++;
        localStorage.setItem('wa_sent_today',_waSentCount);
        localStorage.setItem('wa_sent_date',new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('📲 Message copied! Opening WhatsApp for '+a.patient,'success');
    }

    // Send clinic Google Maps location to patient via WhatsApp
    function sendClinicLocation(id) {
        var a = (_appointments||[]).find(function(x){ return x.id===id; }); if (!a) return;
        var phone = (String(a.phone||'')).replace(/[^\d]/g,'');
        if (!phone) { showToast('No phone number saved','warning'); return; }
        var name = a.patient || 'Patient';
        var mapsUrl = 'https://maps.app.goo.gl/4U5eAwWFZW575XFk6?g_st=awb';
        var msg = '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *' + name + '*! 😊\n\n' +
            'Here is our clinic location on Google Maps:\n' +
            '📍 ' + mapsUrl + '\n\n' +
            '📞 8688033072 | 9396522492';
        _waSentCount++;
        localStorage.setItem('wa_sent_today', _waSentCount);
        localStorage.setItem('wa_sent_date', new Date().toISOString().split('T')[0]);
        updateWaStats();
        openWhatsApp(phone, msg);
        showToast('📍 Location message opening for ' + name, 'success');
    }

    // Init new pages when navigated to
    document.addEventListener('DOMContentLoaded', function(){
        var d=document.getElementById('appt_date');
        if(d) d.valueAsDate=new Date();
        setTimeout(function(){ updateWaPreview(); updateWaStats(); }, 500);
        setTimeout(function(){ if(typeof renderDashCalendar==='function') renderDashCalendar(); }, 300);
    });
    
