/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── WA Template Editor ──────────────────────────────────────────────
    var _waTmplEditKey = null;

    var _waTmplDefaults = {
        reminder24:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '⏰ *Appointment Reminder – Tomorrow*\n\n' +
            '🕐 *Time:* {time}\n' +
            '🦷 *Treatment:* {reason}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive *5 minutes early*.\n' +
            'Reply *YES* to confirm or call us to reschedule.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🙏',

        reminder1h:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '🔔 *Your appointment is in 1 HOUR!*\n\n' +
            '🕐 *Time:* {time}\n' +
            '🦷 *Treatment:* {reason}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please start heading now. 🚗\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_See you soon!_ 😊',

        reschedule:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 🙏\n\n' +
            '⚠️ *Important Notice*\n\n' +
            'We regret that *Dr. {doctor}* is *unavailable today*\n' +
            'for your *{time}* appointment.\n\n' +
            'We sincerely apologize for the inconvenience.\n\n' +
            'Please call us to reschedule:\n' +
            '📞 *8688033072 | 9396522492*\n\n' +
            'Thank you for your understanding. 🙏\n' +
            '_Sri Sai Speciality Dental Care_',

        confirm:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '✅ *Appointment Confirmed!*\n\n' +
            '📅 *Date:* {date}\n' +
            '🕐 *Time:* {time}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive 5 minutes early.\n' +
            'We look forward to seeing you!\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🦷',

        payment:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 🙏\n\n' +
            '💰 *Payment Reminder*\n\n' +
            'You have an outstanding balance.\n' +
            'Kindly settle before your next visit.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            'Thank you! 😊',

        followup:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '💙 *Follow-up Check*\n\n' +
            'Hope you are recovering well after your treatment.\n\n' +
            'Call us for any concerns.\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_We care about your smile!_ 🦷',

        patReschedule:
            '🦷 *Sri Sai Speciality Dental Care*\n\n' +
            'Hello *{name}*! 😊\n\n' +
            '📅 *Reschedule Confirmed!*\n\n' +
            'We have received your reschedule request.\n' +
            'Your new appointment is confirmed:\n\n' +
            '📅 *Date:* {date}\n' +
            '🕐 *Time:* {time}\n' +
            '👨‍⚕️ *Doctor:* {doctor}\n\n' +
            'Please arrive 5 minutes early.\n' +
            'We look forward to seeing you! 😊\n\n' +
            '📞 *8688033072 | 9396522492*\n' +
            '_Sri Sai Speciality Dental Care_ 🦷'
    };

    var _waTmplLabels = {
        reminder24: '⏰ 24-Hour Reminder',
        reminder1h: '🔔 1-Hour Reminder',
        reschedule: '🔄 Doctor Unavailable — Reschedule',
        confirm:    '✅ Booking Confirmation',
        payment:    '💰 Payment Due',
        followup:   '💙 Follow-up',
        patReschedule: '📅 Patient Reschedule — Confirmed'
    };

    // ── Template Storage: localStorage (fast) + Google Sheets (cross-device sync) ──
    function _getCustomTmpl(key) {
        try { return localStorage.getItem('wa_custom_tmpl_' + key) || null; } catch(e) { return null; }
    }
    function _setCustomTmpl(key, val) {
        try { localStorage.setItem('wa_custom_tmpl_' + key, val); } catch(e) {}
        // Sync all templates to Sheets so every device gets them
        _syncTmplsToSheets();
    }
    function _delCustomTmpl(key) {
        try { localStorage.removeItem('wa_custom_tmpl_' + key); } catch(e) {}
        _syncTmplsToSheets();
    }
    function _getEffectiveTmpl(key) {
        return _getCustomTmpl(key) || _waTmplDefaults[key] || '';
    }

    // Save all custom templates as one JSON blob to Google Sheets Settings sheet
    function _syncTmplsToSheets() {
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var allTmpls = {};
        Object.keys(_waTmplDefaults).forEach(function(key) {
            var v = _getCustomTmpl(key);
            if (v) allTmpls[key] = v;
        });
        var p = new URLSearchParams();
        p.append('action', 'saveSettings');
        p.append('settingKey', 'wa_templates');
        p.append('settingValue', JSON.stringify(allTmpls));
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .catch(function(){});
    }

    // Load templates from Sheets on startup — overwrites localStorage cache
    function _loadTmplsFromSheets() {
        if (!CONFIG.apiUrl || CONFIG.apiUrl.includes('YOUR_WEB_APP')) return;
        var p = new URLSearchParams();
        p.append('action', 'getSettings');
        p.append('settingKey', 'wa_templates');
        fetch(CONFIG.apiUrl + '?' + p.toString(), { method: 'GET', redirect: 'follow' })
            .then(function(r){ return r.json(); })
            .then(function(res){
                if (!res.success || !res.value) return;
                try {
                    var tmpls = JSON.parse(res.value);
                    var changed = false;
                    Object.keys(tmpls).forEach(function(key) {
                        if (tmpls[key] && tmpls[key] !== (_getCustomTmpl(key)||'')) {
                            try { localStorage.setItem('wa_custom_tmpl_' + key, tmpls[key]); } catch(e) {}
                            changed = true;
                        }
                    });
                    if (changed) {
                        _refreshAllTmplPreviews();
                        showToast('📋 Message templates synced from cloud', 'success');
                        // Refresh the Quick Send preview if it's visible
                        if (typeof refreshWaMsg === 'function') setTimeout(refreshWaMsg, 50);
                    }
                } catch(e) {}
            })
            .catch(function(){});
    }

    function openWaTmplEdit(key) {
        _waTmplEditKey = key;
        var modal = document.getElementById('waTmplEditModal');
        document.getElementById('waTmplEditText').value = _getEffectiveTmpl(key);
        modal.style.display = 'flex';
        var hasCustom = !!_getCustomTmpl(key);
        document.getElementById('waTmplEditName').innerHTML =
            (_waTmplLabels[key] || key) +
            (hasCustom ? ' <span style="font-size:10px;background:#e8f5e9;color:#27ae60;border-radius:4px;padding:1px 6px;margin-left:6px;">✔ Custom saved</span>' : '');
    }

    function closeWaTmplEdit() {
        document.getElementById('waTmplEditModal').style.display = 'none';
        _waTmplEditKey = null;
    }

    function saveWaTmplEdit() {
        if (!_waTmplEditKey) return;
        var val = document.getElementById('waTmplEditText').value.trim();
        if (!val) { showToast('Template cannot be empty', 'warning'); return; }
        _setCustomTmpl(_waTmplEditKey, val);
        _refreshAllTmplPreviews();
        showToast('✅ Template saved & syncing to all devices...', 'success');
        closeWaTmplEdit();
    }

    function resetWaTmplEdit() {
        if (!_waTmplEditKey) return;
        if (!confirm('Reset "' + (_waTmplLabels[_waTmplEditKey]||_waTmplEditKey) + '" to default?')) return;
        _delCustomTmpl(_waTmplEditKey);
        document.getElementById('waTmplEditText').value = _waTmplDefaults[_waTmplEditKey] || '';
        document.getElementById('waTmplEditName').innerHTML = _waTmplLabels[_waTmplEditKey] || _waTmplEditKey;
        showToast('↩ Reset to default & syncing...', 'info');
    }

    // Close modal on backdrop click
    document.getElementById('waTmplEditModal').addEventListener('click', function(e) {
        if (e.target === this) closeWaTmplEdit();
    });

    function _refreshAllTmplPreviews() {
        Object.keys(_waTmplDefaults).forEach(function(key) {
            var el = document.getElementById('tmplPreview_' + key);
            if (!el) return;
            var custom = _getCustomTmpl(key);
            if (custom) {
                // Show custom text as plain text with line breaks
                el.innerHTML = custom.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
                el.style.borderTop = '1px dashed #27ae60';
                el.style.paddingTop = '6px';
                el.style.marginTop = '4px';
            }
        });
    }

    // ── Custom template helpers are now built into refreshWaMsg, buildApptMsg, buildWabpMsg ──
    // No override needed — those functions check _getCustomTmpl() directly.
    
