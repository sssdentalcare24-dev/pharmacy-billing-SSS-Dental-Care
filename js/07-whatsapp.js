/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    function openWhatsApp(phone, msg) {
        // Copy message to clipboard first
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(msg).then(function() {
                showToast('✅ Message copied! Paste it in WhatsApp chat.', 'success');
            }).catch(function(){});
        } else {
            // Fallback: select textarea
            var ta = document.createElement('textarea');
            ta.value = msg;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            try { document.execCommand('copy'); } catch(e) {}
            document.body.removeChild(ta);
        }
        // Open WhatsApp with phone only (no text in URL = no encoding corruption)
        var cleanPhone = (String(phone||'')).replace(/[^\d]/g,'');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
        // Small delay so toast shows first
        setTimeout(function(){
            window.open('https://wa.me/' + cleanPhone, '_blank');
        }, 400);
    }
    
