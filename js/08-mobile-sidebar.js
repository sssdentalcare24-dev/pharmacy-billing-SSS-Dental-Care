/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    function toggleSidebar() {
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
    function closeSidebar() {
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (!sidebar) return;
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        // Use rAF to restore scroll after transition finishes, prevents stuck-scroll on iPad
        requestAnimationFrame(function() { document.body.style.overflow = ''; });
    }
    // Close sidebar on nav item click (mobile)
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            if (window.innerWidth <= 1024) closeSidebar();
        });
    });
    // Swipe left on sidebar to close, swipe right from edge to open
    (function() {
        var startX, startY, sidebar = document.querySelector('.sidebar');
        // Swipe left to close
        sidebar.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: true});
        sidebar.addEventListener('touchend', function(e) {
            if (!startX) return;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = e.changedTouches[0].clientY - startY;
            if (dx < -50 && Math.abs(dy) < 80) closeSidebar();
            startX = null;
        }, {passive: true});
        // Swipe right from left edge to open
        document.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: true});
        document.addEventListener('touchend', function(e) {
            if (startX === null || startX === undefined) return;
            var dx = e.changedTouches[0].clientX - startX;
            var dy = Math.abs(e.changedTouches[0].clientY - startY);
            if (dx > 60 && dy < 80 && startX < 25 && window.innerWidth <= 1024) {
                if (!sidebar.classList.contains('open')) toggleSidebar();
            }
        }, {passive: true});
    })();
    
