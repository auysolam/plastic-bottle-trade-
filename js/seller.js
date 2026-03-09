document.addEventListener('DOMContentLoaded', () => {
    // Check if db is available
    if (typeof db === 'undefined') {
        console.error("Store not loaded");
        return;
    }

    const LIFF_ID = "2009372777-hgdgiWRi"; // TODO: ใส่ LIFF ID ของคุณที่นี่ (เว้นว่างไว้เพื่อจำลองการ Login)
    let currentUser = null;

    // --- References ---
    const userPointsEl = document.getElementById('user-points');
    const priceListEl = document.getElementById('price-list');
    const rewardsListEl = document.getElementById('rewards-list');
    const sellForm = document.getElementById('sell-form');
    const getLocationBtn = document.getElementById('get-location-btn');
    const locationDisplay = document.getElementById('location-display');
    const statusCard = document.getElementById('status-card');

    let currentLat = null;
    let currentLng = null;

    // --- LIFF Initialization ---
    async function initLiff() {
        if (!LIFF_ID) {
            console.warn("LIFF_ID is empty. Cannot initialize LINE Login properly.");
            showLoginOverlay();
            return;
        }

        try {
            if (typeof liff === 'undefined') {
                throw new Error("LIFF SDK not available");
            }

            await liff.init({ liffId: LIFF_ID });
            
            if (liff.isLoggedIn()) {
                const profile = await liff.getProfile();
                handleUserLogin(profile);
            } else {
                // Show login overlay
                showLoginOverlay();
            }
        } catch (err) {
            console.error("LIFF Init error", err);
            showLoginOverlay();
        }
    }

    function showLoginOverlay() {
        const loginOverlay = document.createElement('div');
        loginOverlay.innerHTML = `
            <div style="position:fixed; top:0;left:0; right:0;bottom:0; background:var(--background); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
                <div style="font-size:3rem; margin-bottom:16px;">♻️</div>
                <h2 style="color:var(--text-main); font-family:var(--font-family);">RecycleHub</h2>
                <p style="color:var(--text-muted); margin-bottom:24px;">กรุณาเข้าสู่ระบบผ่านบัญชี LINE</p>
                <button id="liff-login-btn" class="btn btn-primary w-100" style="background-color:#06C755; color:white; max-width:300px; font-weight:700;">เข้าสู่ระบบด้วย LINE</button>
                ${!LIFF_ID ? '<p style="color:var(--danger); margin-top:15px; font-size: 0.9rem;">⚠️ ระบบยังไม่ได้ตั้งค่า LIFF ID สำหรับใช้งาน LINE Login</p>' : ''}
            </div>
        `;
        document.body.appendChild(loginOverlay);
        
        document.getElementById('liff-login-btn').addEventListener('click', () => {
            if(typeof liff !== 'undefined' && LIFF_ID) {
                liff.login();
            } else {
                alert("เกิดข้อผิดพลาด: ผู้ดูแลระบบยังไม่ได้ตั้งค่า LIFF ID\n\n(สำหรับผู้ดูแลระบบ: กรุณาแก้ไขไฟล์ js/seller.js บรรทัดที่ 8 เพื่อใส่ LIFF_ID)");
            }
        });
    }

    function handleUserLogin(profile) {
        currentUser = profile;
        
        // Save minimal profile data to mock store
        db.saveUserProfile(profile.userId, {
            lineName: profile.displayName,
            pictureUrl: profile.pictureUrl
        });

        // Update UI
        const profileImg = document.getElementById('profile-img');
        const profileName = document.getElementById('profile-name');
        
        if(profileImg && profileName) {
            profileImg.src = profile.pictureUrl || "https://via.placeholder.com/32";
            profileImg.style.display = 'block';
            profileName.textContent = profile.displayName;
            profileName.style.display = 'block';
        }

        // Fill form defaults
        const nameInput = document.getElementById('seller-name');
        if(nameInput && !nameInput.value) nameInput.value = profile.displayName;

        const phoneInput = document.getElementById('seller-phone');
        const savedData = db.getUserProfile(profile.userId);
        if(phoneInput && savedData && savedData.phone && !phoneInput.value) {
            phoneInput.value = savedData.phone;
        }

        initApp();
    }

    // --- Initialization ---
    function initApp() {
        updatePoints();
        renderPrices();
        renderRewards();
        checkPendingRequest();
    }

    function updatePoints() {
        if(userPointsEl && currentUser) {
            userPointsEl.textContent = `${db.getPoints(currentUser.userId)} แต้ม`;
        }
    }

    function renderPrices() {
        if(!priceListEl) return;
        const prices = db.getPrices();
        priceListEl.innerHTML = `
            <div class="price-item shadow-sm">
                <div class="type">ขวดใส (PET)</div>
                <div class="amount">${prices.clear.toFixed(2)} ฿</div>
                <small class="text-muted">/ กก.</small>
            </div>
            <div class="price-item shadow-sm">
                <div class="type">ขวดสี/ขุ่น</div>
                <div class="amount">${prices.color.toFixed(2)} ฿</div>
                <small class="text-muted">/ กก.</small>
            </div>
            <div class="price-item shadow-sm">
                <div class="type">ขวดรวมๆ</div>
                <div class="amount">${prices.mixed ? prices.mixed.toFixed(2) : '5.00'} ฿</div>
                <small class="text-muted">/ กก.</small>
            </div>
        `;
    }

    function renderRewards() {
        if(!rewardsListEl) return;
        const rewards = db.getRewards();
        rewardsListEl.innerHTML = rewards.map(r => `
            <div class="reward-card">
                <div class="reward-img-placeholder">
                    ${r.type === 'image' ? `<img src="${r.icon}" style="width:100%; height:100%; object-fit:cover;">` : r.icon}
                </div>
                <div class="reward-info">
                    <div class="reward-title">${r.name}</div>
                    <span class="reward-cost">${r.cost} แต้ม</span>
                    <button class="btn btn-sm btn-outline btn-redeem mt-2 w-100" data-id="${r.id}" data-cost="${r.cost}" style="font-size:0.8rem; padding:6px;">แลกรางวัล</button>
                </div>
            </div>
        `).join('');

        // Attach Redeem Event
        document.querySelectorAll('.btn-redeem').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(!currentUser) {
                    alert("กรุณาเข้าสู่ระบบ");
                    return;
                }

                const id = e.target.getAttribute('data-id');
                const cost = parseInt(e.target.getAttribute('data-cost'));
                const currentPoints = db.getPoints(currentUser.userId);

                if (currentPoints < cost) {
                    alert('คะแนนสะสมของคุณไม่เพียงพอสำหรับการแลกของรางวัลนี้');
                    return;
                }

                const name = prompt('กรุณาระบุชื่อผู้รับของรางวัล:', currentUser.displayName);
                if (!name) return;
                
                const savedProfile = db.getUserProfile(currentUser.userId);
                const phone = prompt('กรุณาระบุเบอร์โทรศัพท์สำหรับติดต่อส่งของ:', savedProfile ? savedProfile.phone : '');
                if (!phone) return;

                if (db.deductPoints(cost, currentUser.userId)) {
                    db.addRedemption(id, name, phone, currentUser.userId);
                    updatePoints();
                    alert('ส่งคำขอแลกของรางวัลสำเร็จ! ผู้รับซื้อจะติดต่อกลับเพื่อนัดรับของ');
                }
            });
        });
    }

    function checkPendingRequest() {
        // Simplified check: if there's any pending request, show status
        // Let's filter by userId
        const requests = db.getRequests();
        const hasPending = requests.some(r => r.status === 'pending' && (!r.userId || r.userId === currentUser.userId));
        
        if (hasPending && statusCard) {
            statusCard.classList.remove('hidden');
        } else if(statusCard) {
            statusCard.classList.add('hidden');
        }
    }

    // --- Geolocation ---
    if (getLocationBtn) {
        getLocationBtn.addEventListener('click', () => {
            locationDisplay.value = "กำลังดึงตำแหน่ง...";
            
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        currentLat = position.coords.latitude;
                        currentLng = position.coords.longitude;
                        locationDisplay.value = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
                        locationDisplay.classList.add('border-success');
                    },
                    (error) => {
                        console.error(error);
                        handleLocationError();
                    },
                    { enableHighAccuracy: true, timeout: 5000 }
                );
            } else {
                handleLocationError(true);
            }
        });
    }

    function handleLocationError(noSupport = false) {
        let msg = noSupport ? "เบราว์เซอร์ไม่รองรับดึงตำแหน่ง (หรืออาจจะไม่ได้รันเว็บผ่าน HTTPS ลิงก์ที่ปลอดภัย)" : "ไม่สามารถดึงได้ (อาจเพราะไม่ได้เปิด GPS หรือเบราว์เซอร์บล็อกไว้)";
        msg += "\n\nต้องการใช้ 'พิกัดจำลอง' (Mock Location) เพื่อทดสอบระบบต่อไปหรือไม่?";
        
        if(confirm(msg)) {
            // สุ่มพิกัดแถวๆ กรุงเทพฯ สำหรับทดสอบ
            currentLat = 13.7563 + ((Math.random() - 0.5) * 0.05);
            currentLng = 100.5018 + ((Math.random() - 0.5) * 0.05);
            locationDisplay.value = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
            locationDisplay.classList.add('border-success');
        } else {
            locationDisplay.value = "";
            locationDisplay.removeAttribute('readonly'); // ปล่อยให้พิมพ์เอง
        }
    }

    // --- Form Submission ---
    const itemPhotoInput = document.getElementById('item-photo');
    const photoPreview = document.getElementById('photo-preview');
    const photoPlaceholder = document.getElementById('photo-placeholder');
    let capturedPhotoDataUrl = null;

    if (itemPhotoInput) {
        itemPhotoInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(event) {
                    capturedPhotoDataUrl = event.target.result;
                    if (photoPreview) {
                        photoPreview.src = capturedPhotoDataUrl;
                        photoPreview.style.display = 'block';
                    }
                    if (photoPlaceholder) {
                        photoPlaceholder.style.opacity = '0'; // hide placeholder text
                    }
                };
                reader.readAsDataURL(file);
            } else {
                capturedPhotoDataUrl = null;
                if (photoPreview) photoPreview.style.display = 'none';
                if (photoPlaceholder) photoPlaceholder.style.opacity = '1';
            }
        });
    }

    if (sellForm) {
        sellForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const name = document.getElementById('seller-name').value;
            const phone = document.getElementById('seller-phone').value;
            const date = document.getElementById('pickup-date').value;
            const time = document.getElementById('pickup-time').value;
            const type = document.getElementById('bottle-type').value;
            
            if (!currentLat && locationDisplay.hasAttribute('readonly')) {
                alert('กรุณากดปุ่ม "ดึงตำแหน่งปัจจุบัน" ก่อนส่งคำร้อง');
                return;
            }

            // Save phone to profile
            if(currentUser) {
                db.saveUserProfile(currentUser.userId, { phone: phone });
            }

            const requestData = {
                userId: currentUser ? currentUser.userId : null,
                name,
                phone,
                date,
                time,
                type,
                location: { lat: currentLat, lng: currentLng, raw: locationDisplay.value },
                photo: capturedPhotoDataUrl
            };

            db.addRequest(requestData);
            
            alert('ส่งคำร้องสำเร็จ! รอเจ้าหน้าที่ติดต่อกลับ');
            sellForm.reset();
            locationDisplay.value = "";
            currentLat = null;
            currentLng = null;
            capturedPhotoDataUrl = null;
            if (photoPreview) photoPreview.style.display = 'none';
            if (photoPlaceholder) photoPlaceholder.style.opacity = '1';
            
            checkPendingRequest();
        });
    }

    // Start
    initLiff();
});
