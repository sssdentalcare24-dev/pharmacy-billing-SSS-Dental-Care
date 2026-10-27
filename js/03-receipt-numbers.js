/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    // ── Auto Receipt Number ──────────────────────────────────────
    // Shared counter stored in localStorage as 'receipt_counter'
    // Format: year + 4-digit padded number e.g. 2026-0001

    function getNextReceiptNo() {
        var year = new Date().getFullYear();
        var key  = 'receipt_counter_' + year;
        var curr = parseInt(localStorage.getItem(key) || '0');
        var next = curr + 1;
        localStorage.setItem(key, next);
        return year + '-' + String(next).padStart(4, '0');
    }

    function peekNextReceiptNo() {
        var year = new Date().getFullYear();
        var key  = 'receipt_counter_' + year;
        var curr = parseInt(localStorage.getItem(key) || '0');
        return year + '-' + String(curr + 1).padStart(4, '0');
    }

    function autoFillNo(fieldId) {
        var el = document.getElementById(fieldId);
        if (!el) return;
        var no = getNextReceiptNo();
        el.value = no;
        el.style.borderColor = '#27ae60';
        el.style.background  = '#f0fff4';
        setTimeout(function(){ el.style.borderColor = ''; el.style.background = ''; }, 1500);
        // Trigger any relevant preview/recalc
        el.dispatchEvent(new Event('input'));
        showToast('✅ Receipt No. ' + no + ' assigned', 'success');
    }
    // ── End Auto Receipt Number ──────────────────────────────────
    
