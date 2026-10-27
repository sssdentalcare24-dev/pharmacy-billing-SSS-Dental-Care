/* Sri Sai Speciality Dental Care — billing app. Split from the original single index.html. */
    var _trMode = 'Cash';
    function openTreatmentPayment() {
        const patient = (document.getElementById('tr_patient').value||'').trim();
        const amt = parseFloat(document.getElementById('tr_amount').value)||0;
        if (!patient) { showToast('Enter patient name first','warning'); return; }
        if (!amt)     { showToast('Enter treatment amount first','warning'); return; }
        const tDefs = ['Consultation','Teeth Cleaning (Scaling)','Fillings (Amalgam / Composite)','Root Canal Therapy','Crowns','Orthodontic Treatment','Flap Surgery','Extractions','Others'];
        const othTxt = (document.getElementById('tr_others_text')||{}).value||'';
        const sel = tDefs.filter((_,i)=>{ const cb=document.getElementById('tr_t'+(i+1)); return cb&&cb.checked; })
                         .map(t=>t==='Others'&&othTxt?'Others: '+othTxt:t).join(', ')||'Treatment';
        document.getElementById('trPmPatient').textContent    = patient;
        document.getElementById('trPmTreatments').textContent = sel;
        document.getElementById('trPmTotal').textContent      = '₹'+amt.toFixed(2);
        ['trPmTendered','trPmSplitCash','trPmSplitUpi','trPmCardRef'].forEach(id=>{ const e=document.getElementById(id); if(e)e.value=''; });
        document.getElementById('trPmChange').textContent='₹0';
        document.getElementById('trPmChange').style.color='#27ae60';
        document.getElementById('trSplitSt').textContent='';
        document.getElementById('trSplitSt').style.background='#f8f9fa';
        document.getElementById('trQuickChips').innerHTML=[100,200,500,1000,2000].map(v=>
            `<button class="tr-chip" onclick="document.getElementById('trPmTendered').value=${v};calcTrChange();">₹${v}</button>`).join('');
        const upiId=(typeof CONFIG!=='undefined'?CONFIG.upiId:'')||'';
        const upiName=(typeof CONFIG!=='undefined'?CONFIG.upiName:'')||'Sri Sai Dental';
        if (upiId.trim()) {
            document.getElementById('trUpiWarn').style.display='none';
            document.getElementById('trUpiCard').style.display='block';
            document.getElementById('trUpiAmt').textContent='₹'+amt.toFixed(2);
            document.getElementById('trUpiIdShow').textContent=upiId;
            const lnk=`upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Dental')}`;
            document.getElementById('trUpiQr').src=`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(lnk)}`;
        } else {
            document.getElementById('trUpiWarn').style.display='block';
            document.getElementById('trUpiCard').style.display='none';
        }
        selectTrMode('Cash');
        const modal=document.getElementById('trPayModal');
        modal.style.display='flex';
        requestAnimationFrame(()=>requestAnimationFrame(()=>modal.classList.add('tr-open')));
        document.body.style.overflow='hidden';
    }
    function closeTrPayModal() {
        const modal=document.getElementById('trPayModal');
        modal.classList.remove('tr-open');
        setTimeout(()=>{ modal.style.display='none'; },370);
        document.body.style.overflow='';
    }
    function selectTrMode(mode) {
        _trMode=mode;
        ['Cash','UPI','Card','Split'].forEach(m=>{
            document.getElementById('trpm-'+m).classList.toggle('tr-active',m===mode);
            document.getElementById('trSec'+m).classList.toggle('tr-hide',m!==mode);
        });
    }
    function calcTrChange() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        const amt=parseFloat(document.getElementById('trPmTendered').value)||0;
        const chg=amt-total;
        const el=document.getElementById('trPmChange');
        el.textContent=chg>=0?'₹'+chg.toFixed(2):'-₹'+Math.abs(chg).toFixed(2);
        el.style.color=chg>=0?'#27ae60':'#e74c3c';
    }
    function calcTrSplit() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        const cash=parseFloat(document.getElementById('trPmSplitCash').value)||0;
        const upi=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
        const rem=total-cash-upi;
        const el=document.getElementById('trSplitSt');
        if(Math.abs(rem)<0.01){el.textContent='✅ Balanced';el.style.background='#e8f8ee';el.style.color='#27ae60';}
        else if(rem>0){el.textContent='⚠️ ₹'+rem.toFixed(2)+' still pending';el.style.background='#fff8e1';el.style.color='#e67e22';}
        else{el.textContent='❌ Overpaid by ₹'+Math.abs(rem).toFixed(2);el.style.background='#fff0f0';el.style.color='#e74c3c';}
    }
    function confirmTrPayment() {
        const total=parseFloat((document.getElementById('trPmTotal').textContent||'').replace('₹',''))||0;
        if(_trMode==='Cash'&&(parseFloat(document.getElementById('trPmTendered').value)||0)<total){showToast('Amount tendered is less than total','warning');return;}
        if(_trMode==='Split'){
            const c=parseFloat(document.getElementById('trPmSplitCash').value)||0;
            const u=parseFloat(document.getElementById('trPmSplitUpi').value)||0;
            if(Math.abs(c+u-total)>0.5){showToast('Split amounts must add up to total','warning');return;}
        }
        closeTrPayModal();
        const modeLabel={Cash:'💵 Cash',UPI:'📱 UPI / GPay',Card:'💳 Card',Split:'🔀 Split'};
        document.getElementById('trSucPat').textContent=document.getElementById('tr_patient').value||'—';
        document.getElementById('trSucNo').textContent=document.getElementById('tr_no').value||'—';
        document.getElementById('trSucAmt').textContent='₹'+total.toFixed(2);
        document.getElementById('trSucMode').textContent=modeLabel[_trMode]||_trMode;
        setTimeout(()=>document.getElementById('trSuccessSheet').classList.add('tr-open'),220);
        printTreatmentReceipt();
    }
    function trSucPrint(){closeTrSuccess();setTimeout(()=>printBillHtml(buildTreatmentReceiptHTML(true)),150);}
    function closeTrSuccess(){document.getElementById('trSuccessSheet').classList.remove('tr-open');}
    
