document.addEventListener('DOMContentLoaded', () => {
    if (typeof db === 'undefined') {
        console.error("Store not loaded");
        return;
    }

    // --- Tab Navigation Setup ---
    const navItems = document.querySelectorAll('.nav-item[data-tab]');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            
            // Activate Tab Link
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            // Activate Pane
            tabPanes.forEach(pane => pane.classList.remove('active'));
            document.getElementById(`tab-${tabId}`).classList.add('active');

            // Force map resize when map tab is opened
            if (tabId === 'map' && map) {
                setTimeout(() => map.invalidateSize(), 100);
            }
        });
    });

    // --- Admin Functionality ---
    const requestListContainer = document.getElementById('request-list-container');
    const redemptionListContainer = document.getElementById('redemption-list-container');
    const adminRewardsList = document.getElementById('admin-rewards-list');
    const filterDateEl = document.getElementById('filter-date');
    
    // Map instance
    let map = null;
    let markers = [];

    // Init
    function init() {
        initMap();
        renderRequests();
        renderRedemptions();
        initSettings();
        initCalculator();
        initInventory();
        initWeather();
    }

    // --- Dashboard: Request List ---
    function renderRequests() {
        if (!requestListContainer) return;
        
        let requests = db.getRequests();
        
        // Filter by date if selected
        const filterDate = filterDateEl.value;
        if (filterDate) {
            requests = requests.filter(r => r.date === filterDate);
        }

        // Sort: pending first, then by sequence if available
        requests.sort((a,b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            if (a.status === 'pending' && b.status === 'pending' && a.sequence && b.sequence) {
                return a.sequence - b.sequence;
            }
            return 0; // maintain original if no sequence
        });

        if (requests.length === 0) {
            requestListContainer.innerHTML = '<div class="card text-center"><p class="text-muted">ไม่มีคำร้องในวันนี้</p></div>';
            return;
        }

        requestListContainer.innerHTML = requests.map(r => `
            <div class="request-card" style="border-left: 4px solid ${r.status === 'pending' ? 'var(--warning)' : 'var(--success)'}">
                <div class="req-info">
                    <h4>
                        ${r.sequence && r.status === 'pending' ? `<span style="background:var(--primary); color:white; padding: 2px 8px; border-radius: 50%; font-size: 0.8rem; margin-right:5px;">${r.sequence}</span>` : ''} 
                        ${r.name} - ${r.phone}
                    </h4>
                    <div class="req-meta">
                        📅 วันที่: ${r.date}ช่วง ${r.time}
                        <br>🍼 ประเภท: ${r.type === 'clear' ? 'ขวดใส' : r.type === 'color' ? 'ขวดสี' : r.type === 'mixed' ? 'ขวดรวมๆ' : 'อื่นๆ'}
                        <br>📌 สถานะ: ${r.status === 'pending' ? 'รอรับ' : 'เสร็จสิ้น'}
                        ${r.distance ? `<br>🚗 ระยะทาง: ${r.distance} กม.` : ''}
                    </div>
                    ${r.photo ? `<div style="margin-top: 10px;"><img src="${r.photo}" alt="ภาพสินค้า" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #ddd; max-height: 200px; object-fit: cover;"></div>` : ''}
                </div>
                <div class="req-actions">
                    ${r.status === 'pending' ? 
                        `<button class="btn btn-sm btn-outline view-map-btn" data-lat="${r.location.lat}" data-lng="${r.location.lng}">ดูแผนที่</button>
                         <button class="btn btn-sm btn-success mark-done-btn" data-id="${r.id}">รับแล้ว</button>` : 
                        `<span style="color:var(--success); font-weight:bold;">✓ สำเร็จแล้ว</span>`
                    }
                </div>
            </div>
        `).join('');

        // Attach events
        document.querySelectorAll('.mark-done-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                const requests = db.getRequests();
                const req = requests.find(r => r.id === id);
                
                if (req) {
                    // Pre-fill calculator data
                    const calcName = document.getElementById('calc-name');
                    const phonePoints = document.getElementById('calc-phone-points');
                    
                    if (calcName) {
                        calcName.value = req.name;
                    }
                    if (phonePoints) {
                        phonePoints.value = req.phone;
                    }
                    
                    // Switch to Calculator Tab
                    const calcTab = document.querySelector('.nav-item[data-tab="calculator"]');
                    if (calcTab) {
                        calcTab.click();
                    }
                }
                
                db.updateRequestStatus(id, 'completed');
                renderRequests(); // re-render list
                renderMapMarkers(); // update map
            });
        });

        document.querySelectorAll('.view-map-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lat = parseFloat(e.target.getAttribute('data-lat'));
                const lng = parseFloat(e.target.getAttribute('data-lng'));
                
                // Switch to map tab
                document.querySelector('.nav-item[data-tab="map"]').click();
                
                if (map && !isNaN(lat) && !isNaN(lng)) {
                    map.setView([lat, lng], 15);
                }
            });
        });
    }

    if (filterDateEl) {
        // Default to today
        const today = new Date().toISOString().split('T')[0];
        filterDateEl.value = today;
        filterDateEl.addEventListener('change', renderRequests);
    }

    // --- Smart Routing Logic ---
    function enableSmartRoute(startLat, startLng) {
        
        let requests = db.getRequests();
        const filterDate = filterDateEl.value;
        if (filterDate) {
            requests = requests.filter(r => r.date === filterDate);
        }
        
        let pendingRequests = requests.filter(r => r.status === 'pending' && r.location && r.location.lat);
        if (pendingRequests.length === 0) return;

        // Nearest Neighbor Algorithm
        let currentLoc = { lat: startLat, lng: startLng };
        let sequence = 1;
        let unvisited = [...pendingRequests];

        while (unvisited.length > 0) {
            let nearestIdx = 0;
            let minDistance = Infinity;

            for (let i = 0; i < unvisited.length; i++) {
                const dist = calculateDistance(currentLoc.lat, currentLoc.lng, unvisited[i].location.lat, unvisited[i].location.lng);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestIdx = i;
                }
            }

            const nearestReq = unvisited[nearestIdx];
            nearestReq.sequence = sequence;
            nearestReq.distance = minDistance.toFixed(2);
            sequence++;
            
            currentLoc = { lat: nearestReq.location.lat, lng: nearestReq.location.lng };
            unvisited.splice(nearestIdx, 1);
        }
        
        // Re-read to bind back mutations
        const allSaved = db.getRequests();
        allSaved.forEach(s => {
            const mapped = pendingRequests.find(p => p.id === s.id);
            if(mapped) {
                s.sequence = mapped.sequence;
                s.distance = mapped.distance;
            }
        });
        db.saveData(db.data); // save sequence

        // 1. Re-render List
        renderRequests();
        // 2. Re-render Map with numbers
        renderMapMarkers();
        // 3. Build Google Maps Link
        buildGoogleMapsLink(startLat, startLng, pendingRequests);
    }

    function buildGoogleMapsLink(originLat, originLng, sortedRequests) {
        sortedRequests.sort((a,b) => a.sequence - b.sequence);
        const destination = sortedRequests[sortedRequests.length - 1];
        const waypoints = sortedRequests.slice(0, -1).map(r => `${r.location.lat},${r.location.lng}`).join('|');
        
        const gmapsBtn = document.getElementById('btn-open-maps');
        if(gmapsBtn) {
            let url = `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destination.location.lat},${destination.location.lng}&travelmode=driving`;
            if (waypoints) {
                url += `&waypoints=${waypoints}`;
            }
            gmapsBtn.href = url;
            gmapsBtn.style.display = 'block'; // Show button
        }
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula for JS
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Attach Smart Route button
    setTimeout(() => {
        const autoRouteBtn = document.getElementById('btn-auto-route');
        if (autoRouteBtn) {
            autoRouteBtn.addEventListener('click', () => {
                autoRouteBtn.textContent = 'กำลังหาพิกัด...';
                
                if ("geolocation" in navigator) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            autoRouteBtn.textContent = '🚗 จัดแผนรับของอัตโนมัติ';
                            enableSmartRoute(position.coords.latitude, position.coords.longitude);
                        },
                        (error) => {
                            console.error(error);
                            if(confirm("ไม่สามารถดึงตำแหน่งผู้ซื้อได้ ต้องการใช้พิกัดจำลอง (กรุงเทพฯ) หรือไม่?")) {
                                autoRouteBtn.textContent = '🚗 จัดแผนรับของอัตโนมัติ';
                                enableSmartRoute(13.7563, 100.5018);
                            } else {
                                autoRouteBtn.textContent = '🚗 จัดแผนรับของอัตโนมัติ';
                            }
                        },
                        { enableHighAccuracy: true, timeout: 5000 }
                    );
                } else {
                    if(confirm("เบราว์เซอร์ไม่รองรับดึงพิกัด ต้องการใช้พิกัดจำลอง (กรุงเทพฯ) หรือไม่?")) {
                        autoRouteBtn.textContent = '🚗 จัดแผนรับของอัตโนมัติ';
                        enableSmartRoute(13.7563, 100.5018);
                    } else {
                        autoRouteBtn.textContent = '🚗 จัดแผนรับของอัตโนมัติ';
                    }
                }
            });
        }
    }, 100);

    // --- Map View (Leaflet) ---
    function initMap() {
        if (typeof L === 'undefined') {
            console.warn("Leaflet not loaded. Map will be disabled.");
            return;
        }

        const mapEl = document.getElementById('requests-map');
        if (!mapEl) return;

        // Default center Bangkok
        map = L.map('requests-map').setView([13.7563, 100.5018], 10);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(map);

        renderMapMarkers();
    }

    function renderMapMarkers() {
        if (!map) return;
        
        // Clear existing markers
        markers.forEach(m => map.removeLayer(m));
        markers = [];

        const pendingRequests = db.getRequests().filter(r => r.status === 'pending' && r.location && r.location.lat);
        
        if (pendingRequests.length > 0) {
            const bounds = [];
            let previousMarkerLoc = null;
            
            // Draw path if we have sequences
            const sequencedReqs = pendingRequests.filter(r => r.sequence).sort((a,b) => a.sequence - b.sequence);
            if (sequencedReqs.length > 1) {
                const latlngs = sequencedReqs.map(r => [r.location.lat, r.location.lng]);
                const polyline = L.polyline(latlngs, {color: 'var(--primary)', weight: 3, dashArray: '5, 10'}).addTo(map);
                markers.push(polyline);
            }
            
            pendingRequests.forEach(r => {
                const markerCoordinates = [r.location.lat, r.location.lng];
                
                let iconHtml = `
                    <div style="background-color: var(--primary); color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">
                        ${r.sequence ? r.sequence : '📍'}
                    </div>
                `;

                const customIcon = L.divIcon({
                    html: iconHtml,
                    className: 'custom-leaflet-icon',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });

                const marker = L.marker(markerCoordinates, {icon: customIcon}).addTo(map);
                marker.bindPopup(`
                    <strong>${r.sequence ? `[คิวที่ ${r.sequence}] ` : ''}ผู้ขาย: ${r.name}</strong><br>
                    โทร: ${r.phone}<br>
                    นัดเวลา: ${r.time}
                    ${r.distance ? `<br>ระยะห่างจากคิวก่อนหน้า: ${r.distance} กม.` : ''}
                `);
                
                markers.push(marker);
                bounds.push(markerCoordinates);
            });

            // Fit map to show all markers
            if (bounds.length > 0) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        }
    }

    // --- Weather Integration ---
    function initWeather() {
        const weatherWidget = document.getElementById('weather-widget');
        if (!weatherWidget) return;

        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    fetchWeather(position.coords.latitude, position.coords.longitude);
                },
                (error) => {
                    console.error("Weather Geolocation Error:", error);
                    // Default to Bangkok if blocked
                    fetchWeather(13.7563, 100.5018, "กรุงเทพมหานคร (พิกัดจำลอง)");
                },
                { timeout: 10000 }
            );
        } else {
            fetchWeather(13.7563, 100.5018, "กรุงเทพมหานคร (พิกัดจำลอง)");
        }
    }

    async function fetchWeather(lat, lng, cityName = null) {
        const weatherWidget = document.getElementById('weather-widget');
        if (!weatherWidget) return;

        try {
            // Using Open-Meteo free API
            const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,weathercode,precipitation_probability&timezone=auto&forecast_days=1`);
            const data = await response.json();
            
            if (data && data.current_weather) {
                const weather = data.current_weather;
                const weatherInfo = getWeatherDescription(weather.weathercode);
                const date = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
                
                let hourlyHtml = '';
                if (data.hourly) {
                    const currentHourObj = new Date();
                    // Convert to string "YYYY-MM-DDTHH:00" to match Open-Meteo's time array, 
                    // or just use hour index since forecast_days=1 means 0-23 hours
                    const currentHourStr = currentHourObj.toISOString().split(':')[0] + ':00';
                    const currentHour = currentHourObj.getHours();

                    const times = data.hourly.time;
                    const temps = data.hourly.temperature_2m;
                    const codes = data.hourly.weathercode;
                    const precip = data.hourly.precipitation_probability;
                    
                    let count = 0;
                    for (let i = 0; i < times.length; i++) {
                        const h = new Date(times[i]).getHours();
                        if (h >= currentHour && count < 8) {
                            const hrInfo = getWeatherDescription(codes[i]);
                            const p = precip ? (precip[i] || 0) : 0;
                            const isNow = count === 0;
                            
                            hourlyHtml += `
                                <div style="display: flex; flex-direction: column; align-items: center; min-width: 65px; padding: 10px; background: ${isNow ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.4)'}; border-radius: 8px; border: 1px solid ${isNow ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}; flex-shrink: 0;">
                                    <div style="font-size: 0.85rem; color: #555; font-weight: ${isNow ? 'bold' : 'normal'};">${isNow ? 'ตอนนี้' : ('0' + h).slice(-2) + ':00'}</div>
                                    <div style="font-size: 1.5rem; margin: 5px 0;">${hrInfo.icon}</div>
                                    <div style="font-weight: bold; font-size: 0.95rem;">${Math.round(temps[i])}°</div>
                                    <div style="font-size: 0.75rem; color: ${p > 20 ? 'var(--primary)' : '#888'}; margin-top: 3px;" title="โอกาสฝนตก">💧 ${p}%</div>
                                </div>
                            `;
                            count++;
                        }
                    }
                }

                weatherWidget.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                            <div class="weather-main" style="margin: 0; padding: 0; background: none; box-shadow: none; display: flex; align-items: center; gap: 15px;">
                                <div class="weather-icon" style="font-size: 3rem; line-height: 1;">${weatherInfo.icon}</div>
                                <div class="weather-info">
                                    <h3 style="margin: 0; font-size: 2rem; line-height: 1;">${weather.temperature}°C</h3>
                                    <p style="margin: 5px 0 0 0; color: #555;">${weatherInfo.text}</p>
                                </div>
                            </div>
                            <div class="weather-details" style="margin: 0; padding: 0; background: none; border: none; text-align: right;">
                                <div class="weather-city" style="font-weight: bold; font-size: 0.95rem;">📍 ${cityName || 'ตำแหน่งปัจจุบันของคุณ'}</div>
                                <div class="weather-date" style="color: #666; font-size: 0.85rem;">${date}</div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px; scrollbar-width: thin;">
                            ${hourlyHtml}
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error("Fetch Weather Error:", error);
            weatherWidget.innerHTML = `<p class="text-muted">ไม่สามารถโหลดข้อมูลสภาพอากาศได้</p>`;
        }
    }

    function getWeatherDescription(code) {
        // WMO Weather interpretation codes (WW)
        const mapping = {
            0: { text: "ท้องฟ้าแจ่มใส", icon: "☀️" },
            1: { text: "ท้องฟ้าโปร่ง", icon: "🌤️" },
            2: { text: "มีเมฆบางส่วน", icon: "⛅" },
            3: { text: "มีเมฆมาก", icon: "☁️" },
            45: { text: "มีหมอก", icon: "🌫️" },
            48: { text: "มีหมอกจัด", icon: "🌫️" },
            51: { text: "ฝนละอองเบาบาง", icon: "🌦️" },
            53: { text: "ฝนละอองปานกลาง", icon: "🌦️" },
            55: { text: "ฝนละอองหนาแน่น", icon: "🌦️" },
            61: { text: "ฝนตกเล็กน้อย", icon: "🌧️" },
            63: { text: "ฝนตกปานกลาง", icon: "🌧️" },
            65: { text: "ฝนตกหนัก", icon: "⛈️" },
            80: { text: "ฝนไล่ช้างเล็กน้อย", icon: "🌦️" },
            81: { text: "ฝนไล่ช้างปานกลาง", icon: "🌦️" },
            82: { text: "ฝนไล่ช้างหนักมาก", icon: "⛈️" },
            95: { text: "พายุฝนฟ้าคะนอง", icon: "⚡" },
        };
        return mapping[code] || { text: "สภาพอากาศแปรปรวน", icon: "🌀" };
    }

    // --- Redemptions List ---
    function renderRedemptions() {
        if (!redemptionListContainer) return;
        
        let redemptions = db.getRedemptions();
        
        // Sort: pending first
        redemptions.sort((a,b) => (a.status === 'pending' ? -1 : 1));

        if (redemptions.length === 0) {
            redemptionListContainer.innerHTML = '<div class="card text-center"><p class="text-muted">ไม่มีคำขอแลกรางวัล</p></div>';
            return;
        }

        redemptionListContainer.innerHTML = redemptions.map(r => {
            const date = new Date(r.date).toLocaleString('th-TH');
            return `
            <div class="request-card" style="border-left: 4px solid ${r.status === 'pending' ? 'var(--warning)' : 'var(--success)'}">
                <div class="req-info">
                    <h4>🎁 ${r.rewardName}</h4>
                    <div class="req-meta">
                        👤 ผู้ขอแลก: ${r.userName} (${r.userPhone})
                        <br>คะแนนที่ใช้: ${r.cost} แต้ม
                        <br>เวลา: ${date}
                        <br>📌 สถานะ: ${r.status === 'pending' ? 'รอจัดส่ง/รับของ' : 'เสร็จสิ้น'}
                    </div>
                </div>
                <div class="req-actions">
                    ${r.status === 'pending' ? 
                        `<button class="btn btn-sm btn-success mark-redemption-done-btn" data-id="${r.id}">ส่งมอบแล้ว</button>` : 
                        `<span style="color:var(--success); font-weight:bold;">✓ สำเร็จแล้ว</span>`
                    }
                </div>
            </div>`;
        }).join('');

        // Attach events
        document.querySelectorAll('.mark-redemption-done-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                db.updateRedemptionStatus(id, 'completed');
                renderRedemptions(); // re-render list
            });
        });
    }


    // --- Calculator ---
    function initCalculator() {
        const typeSelect = document.getElementById('calc-type');
        const weightInput = document.getElementById('calc-weight');
        const pricePerKgInput = document.getElementById('calc-price-per-kg');
        const totalDisplay = document.getElementById('calc-total');
        const calcForm = document.getElementById('calculator-form');
        const calcName = document.getElementById('calc-name');
        const phonePoints = document.getElementById('calc-phone-points');

        function updateTotal() {
            const weight = parseFloat(weightInput.value) || 0;
            const price = parseFloat(pricePerKgInput.value) || 0;
            
            const total = price * weight;
            totalDisplay.textContent = total.toFixed(2);
        }

        if (typeSelect && pricePerKgInput) {
            // Update predefined price when changing type
            typeSelect.addEventListener('change', () => {
                const type = typeSelect.value;
                const prices = db.getPrices();
                pricePerKgInput.value = type === 'clear' ? prices.clear : type === 'color' ? prices.color : prices.mixed;
                updateTotal();
            });
            
            // Allow manual price override and ensure it captures all keystrokes
            ['input', 'keyup', 'change'].forEach(evt => {
                pricePerKgInput.addEventListener(evt, updateTotal);
            });
            
            // Set initial predefined price
            const initialType = typeSelect.value;
            const initialPrices = db.getPrices();
            pricePerKgInput.value = initialType === 'clear' ? initialPrices.clear : initialType === 'color' ? initialPrices.color : initialPrices.mixed;
        }

        if (weightInput) {
            ['input', 'keyup', 'change'].forEach(evt => {
                weightInput.addEventListener(evt, updateTotal);
            });
            updateTotal();
        }

        if (calcForm) {
            calcForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const totalText = totalDisplay.textContent;
                
                const weight = parseFloat(weightInput.value) || 0;
                const price = parseFloat(pricePerKgInput.value) || 0;
                const totalCost = weight * price;
                const type = typeSelect.value;
                const points = Math.floor(weight); // Use floor/int of weight
                
                // --- Add to Stock ---
                if (weight > 0) {
                    db.addStock(type, weight, totalCost);
                    if (typeof window.renderInventoryCards === 'function') {
                        window.renderInventoryCards();
                    }
                }

                const sellerName = calcName ? calcName.value.trim() : "";
                let pointsMsg = "";
                if (phonePoints.value.trim() !== '') {
                    const phone = phonePoints.value.trim();
                    const found = db.addPointsByPhone(phone, points);
                    if (found) {
                        pointsMsg = `\nให้คะแนนสะสม ${points} แต้ม แก่ผู้ขายเบอร์ ${phone} สำเร็จ`;
                    } else {
                        pointsMsg = `\nให้คะแนน ${points} แต้ม (เบอร์ ${phone} ยังไม่เคยมาระบบด้วย LINE เลยเก็บเป็นแต้มรวมไว้ก่อน)`;
                    }
                } else {
                    db.addPoints(points);
                    pointsMsg = `\nให้คะแนนสะสม ${points} แต้ม (ไม่ได้ระบุเบอร์โทร)`;
                }
                
                alert(`บันทึกสำเร็จ\nผู้ขาย: ${sellerName || 'ทั่วไป'}\nเพิ่มเข้าสต็อก ${weight.toFixed(1)} กก.\nยอดจ่ายเงินสด: ${totalText} บาท${pointsMsg}`);
                
                calcForm.reset();
                updateTotal();
            });
        }
    }

    // --- Inventory ---
    function initInventory() {
        const inventoryGrid = document.getElementById('inventory-overview');
        const sellForm = document.getElementById('inventory-sell-form');
        const historyBody = document.getElementById('inventory-history-body');
        
        // Filters
        const filterType = document.getElementById('inv-filter-type');
        const filterDate = document.getElementById('inv-filter-date');
        const filterMonth = document.getElementById('inv-filter-month');
        const filterYear = document.getElementById('inv-filter-year');
        const rangeGroup = document.getElementById('inv-range-group');
        const filterStart = document.getElementById('inv-filter-start');
        const filterEnd = document.getElementById('inv-filter-end');

        // Form Dates
        const sellDateInput = document.getElementById('sell-out-date');

        if (!inventoryGrid) return;

        // Init form dates to today
        const todayStr = new Date().toISOString().split('T')[0];
        if (sellDateInput) sellDateInput.value = todayStr;
        if (filterStart) filterStart.value = todayStr;
        if (filterEnd) filterEnd.value = todayStr;

        // Populate Years
        const currentYear = new Date().getFullYear();
        if (filterYear) {
            for (let i = currentYear; i >= currentYear - 5; i--) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i + 543; // BE
                filterYear.appendChild(opt);
            }
        }

        function renderInventory() {
            const logs = db.getInventoryLogs();
            const type = filterType.value;
            
            let filteredLogs = logs;

            if (type === 'daily') {
                const dateVal = filterDate.value || new Date().toISOString().split('T')[0];
                filterDate.value = dateVal;
                filteredLogs = logs.filter(l => l.date.startsWith(dateVal));
            } else if (type === 'monthly') {
                const monthVal = filterMonth.value || new Date().toISOString().slice(0, 7);
                filterMonth.value = monthVal;
                filteredLogs = logs.filter(l => l.date.startsWith(monthVal));
            } else if (type === 'yearly') {
                const yearVal = filterYear.value;
                filteredLogs = logs.filter(l => l.date.startsWith(yearVal));
            } else if (type === 'range') {
                const start = filterStart.value;
                const end = filterEnd.value;
                if (start && end) {
                    // Normalize end date to include the whole day
                    const endLimit = new Date(end);
                    endLimit.setHours(23, 59, 59, 999);
                    filteredLogs = logs.filter(l => {
                        const d = new Date(l.date);
                        return d >= new Date(start) && d <= endLimit;
                    });
                }
            }

            // Calculate Totals for Cards
            const summary = {
                clear: { bought: 0, cost: 0, sold: 0, revenue: 0 },
                color: { bought: 0, cost: 0, sold: 0, revenue: 0 },
                mixed: { bought: 0, cost: 0, sold: 0, revenue: 0 }
            };

            filteredLogs.forEach(l => {
                if (l.action === 'buy') {
                    summary[l.type].bought += l.kg;
                    summary[l.type].cost += l.amount;
                } else {
                    summary[l.type].sold += l.kg;
                    summary[l.type].revenue += l.amount;
                }
            });

            // Calculate Current Physical Stock from ALL LOGS
            const allLogs = db.getInventoryLogs();
            const currentStock = { clear: 0, color: 0, mixed: 0 };
            allLogs.forEach(l => {
                if(l.action === 'buy') currentStock[l.type] += l.kg;
                else currentStock[l.type] -= l.kg;
            });

            const types = [
                { id: 'clear', name: 'ขวดใส (PET)', color: 'var(--primary)' },
                { id: 'color', name: 'ขวดสี/ขุ่น', color: 'var(--warning)' },
                { id: 'mixed', name: 'ขวดรวมๆ', color: 'var(--danger)' }
            ];

            inventoryGrid.innerHTML = types.map(t => {
                const s = summary[t.id];
                const stock = Math.max(0, currentStock[t.id]);
                const profit = s.revenue - s.cost;
                const profitText = profit >= 0 ? 
                    `<span style="color:var(--success)">+${profit.toFixed(2)} ฿</span>` : 
                    `<span style="color:var(--danger)">${profit.toFixed(2)} ฿</span>`;

                return `
                <div class="card" style="border-top: 4px solid ${t.color}">
                    <h3 style="margin-bottom:10px;">${t.name}</h3>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>📥 ซื้อเข้า (${type === 'all' ? 'สะสม' : type}):</span>
                        <strong>${s.bought.toFixed(1)} กก.</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>📤 ขายออก (${type === 'all' ? 'สะสม' : type}):</span>
                        <strong>${s.sold.toFixed(1)} กก.</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#666;">
                        <span>💰 ยอดทุน/ยอดรับ (${type === 'all' ? 'สะสม' : type}):</span>
                        <span>${s.cost.toFixed(0)}/${s.revenue.toFixed(0)} ฿</span>
                    </div>
                    <hr style="margin:10px 0; border:0; border-top:1px dashed #ccc;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <span>🛒 สต็อกคงเหลือปัจจุบัน:</span>
                        <strong style="color:var(--primary)">${stock.toFixed(1)} กก.</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:1px solid #eee;">
                        <span>กำไร/ขาดทุน (${type === 'all' ? 'สะสม' : type}):</span>
                        <strong>${profitText}</strong>
                    </div>
                </div>
                `;
            }).join('');

            // Update main dashboard stats
            const totalBought = types.reduce((acc, t) => acc + summary[t.id].bought, 0);
            const totalSold = types.reduce((acc, t) => acc + summary[t.id].sold, 0);
            const totalStock = types.reduce((acc, t) => acc + Math.max(0, currentStock[t.id]), 0);
            const totalCost = types.reduce((acc, t) => acc + summary[t.id].cost, 0);
            const totalRevenue = types.reduce((acc, t) => acc + summary[t.id].revenue, 0);
            const totalProfit = totalRevenue - totalCost;
            
            function updateMainDashboardStats(bought, sold, stock, profit) {
                const elBought = document.getElementById('stat-total-bought');
                const elSold = document.getElementById('stat-total-sold');
                const elStock = document.getElementById('stat-total-stock');
                const elProfit = document.getElementById('stat-total-profit');
                if(elBought) elBought.textContent = bought.toFixed(1);
                if(elSold) elSold.textContent = sold.toFixed(1);
                if(elStock) elStock.textContent = stock.toFixed(1);
                if(elProfit) elProfit.textContent = profit.toFixed(2);
            }
            
            updateMainDashboardStats(totalBought, totalSold, totalStock, totalProfit);

            // Update Sell Out Card Stock Displays
            const sellStockClear = document.getElementById('sell-stock-clear');
            const sellStockColor = document.getElementById('sell-stock-color');
            const sellStockMixed = document.getElementById('sell-stock-mixed');
            if(sellStockClear) sellStockClear.textContent = currentStock.clear.toFixed(1);
            if(sellStockColor) sellStockColor.textContent = currentStock.color.toFixed(1);
            if(sellStockMixed) sellStockMixed.textContent = currentStock.mixed.toFixed(1);
            
            if (typeof updateSellAvailableLabel === 'function') {
                updateSellAvailableLabel();
            }

            // Render History
            if (historyBody) {
                const historyLogs = [...filteredLogs].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
                historyBody.innerHTML = historyLogs.map(l => {
                    const date = new Date(l.date).toLocaleString('th-TH', { 
                        day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' 
                    });
                    const actionText = l.action === 'buy' ? '<span style="color:var(--primary)">📥 ซื้อเข้า</span>' : '<span style="color:var(--success)">📤 ขายออก</span>';
                    const typeText = l.type === 'clear' ? 'ขวดใส' : l.type === 'color' ? 'ขวดสี' : 'รวมๆ';
                    return `
                    <tr>
                        <td style="padding:10px; border-bottom:1px solid #eee; font-size:0.85rem;">${date}</td>
                        <td style="padding:10px; border-bottom:1px solid #eee;">${actionText}</td>
                        <td style="padding:10px; border-bottom:1px solid #eee;">${typeText}</td>
                        <td style="padding:10px; border-bottom:1px solid #eee; text-align:right;">${l.kg.toFixed(1)}</td>
                        <td style="padding:10px; border-bottom:1px solid #eee; text-align:right;">${l.amount.toFixed(2)} ฿</td>
                    </tr>
                    `;
                }).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">ไม่มีข้อมูลในช่วงเวลานี้</td></tr>';
            }
        }

        // Filter events
        if (filterType) {
            filterType.addEventListener('change', () => {
                const val = filterType.value;
                filterDate.style.display = val === 'daily' ? 'block' : 'none';
                filterMonth.style.display = val === 'monthly' ? 'block' : 'none';
                filterYear.style.display = val === 'yearly' ? 'block' : 'none';
                if (rangeGroup) rangeGroup.style.display = val === 'range' ? 'flex' : 'none';
                renderInventory();
            });
        }

        if (filterDate) filterDate.addEventListener('change', renderInventory);
        if (filterMonth) filterMonth.addEventListener('change', renderInventory);
        if (filterYear) filterYear.addEventListener('change', renderInventory);
        if (filterStart) filterStart.addEventListener('change', renderInventory);
        if (filterEnd) filterEnd.addEventListener('change', renderInventory);

        function updateSellAvailableLabel() {
            const sellType = document.getElementById('sell-out-type');
            const sellAvailableLabel = document.getElementById('sell-available-label');
            if (sellType && sellAvailableLabel) {
                const type = sellType.value;
                const allLogs = db.getInventoryLogs();
                let stock = 0;
                allLogs.forEach(l => {
                    if(l.type === type) {
                        if(l.action === 'buy') stock += l.kg;
                        else stock -= l.kg;
                    }
                });
                sellAvailableLabel.textContent = `คงเหลือ: ${Math.max(0, stock).toFixed(1)} กก.`;
                sellAvailableLabel.dataset.stock = stock;
            }
        }

        function updateSellRevenue() {
            const weightInput = document.getElementById('sell-out-weight');
            const priceInput = document.getElementById('sell-out-price-per-kg');
            const revenueInput = document.getElementById('sell-out-revenue');
            if (weightInput && priceInput && revenueInput) {
                const weight = parseFloat(weightInput.value) || 0;
                const price = parseFloat(priceInput.value) || 0;
                revenueInput.value = (weight * price).toFixed(2);
            }
        }

        // Sell Out Form Events
        const sellTypeEl = document.getElementById('sell-out-type');
        const sellWeightEl = document.getElementById('sell-out-weight');
        const sellPriceEl = document.getElementById('sell-out-price-per-kg');

        if (sellTypeEl) sellTypeEl.addEventListener('change', updateSellAvailableLabel);
        if (sellWeightEl) {
            sellWeightEl.addEventListener('input', updateSellRevenue);
            sellWeightEl.addEventListener('change', updateSellRevenue);
        }
        if (sellPriceEl) {
            sellPriceEl.addEventListener('input', updateSellRevenue);
            sellPriceEl.addEventListener('change', updateSellRevenue);
        }

        function updateSellDefaultPrice() {
            const type = sellTypeEl.value;
            const prices = db.getPrices();
            // Using buy prices as a baseline for selling, or 0 if preferred. 
            // In many recycling contexts, selling price is higher than buying price.
            // For now, we'll just pre-fill with the buy price to ensure it's not empty/0.
            sellPriceEl.value = type === 'clear' ? prices.clear : type === 'color' ? prices.color : prices.mixed;
            updateSellRevenue();
        }

        if (sellTypeEl) {
            sellTypeEl.addEventListener('change', updateSellDefaultPrice);
            updateSellDefaultPrice(); // Initial set
        }

        renderInventory();

        renderInventory();

        if (sellForm) {
            sellForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const type = document.getElementById('sell-out-type').value;
                const weight = parseFloat(document.getElementById('sell-out-weight').value) || 0;
                const price = parseFloat(document.getElementById('sell-out-price-per-kg').value) || 0;
                const rev = parseFloat(document.getElementById('sell-out-revenue').value) || 0;
                const date = sellDateInput ? sellDateInput.value : null;

                // Validation: Always check current stock
                const sellAvailableLabel = document.getElementById('sell-available-label');
                const currentStock = parseFloat(sellAvailableLabel.dataset.stock) || 0;
                
                // Use a small epsilon for float comparison
                if (weight > currentStock + 0.001) {
                    alert(`❌ ไม่สามารถขายได้: น้ำหนักที่ระบุ (${weight} กก.) มากกว่าสต็อกที่มีอยู่ (${currentStock.toFixed(1)} กก.)`);
                    return;
                }
                
                if (weight >= 0) {
                    db.sellStock(type, weight, rev, date, true);
                    const typeName = type === 'clear' ? 'ขวดใส' : type === 'color' ? 'ขวดสี' : 'รวมๆ';
                    const msg = `✅ บันทึกการขายออก ${typeName} จำนวน ${weight.toFixed(1)} กก. รวมเป็นเงิน ${rev.toFixed(2)} บาท เรียบร้อยแล้ว`;
                    
                    alert(msg);
                    sellForm.reset();
                    if (sellDateInput) sellDateInput.value = todayStr;
                    updateSellDefaultPrice();
                    updateSellAvailableLabel();
                    renderInventory();
                } else {
                    alert('❌ กรุณาระบุน้ำหนักที่ถูกต้อง');
                }
            });
        }
        
        window.renderInventoryCards = renderInventory; // globally accessible
    }

    // --- Settings ---
    function initSettings() {
        const priceForm = document.getElementById('settings-price-form');
        const priceClear = document.getElementById('setting-price-clear');
        const priceColor = document.getElementById('setting-price-color');
        
        const priceMixed = document.getElementById('setting-price-mixed');
        
        const themeForm = document.getElementById('settings-theme-form');
        const themeSelect = document.getElementById('setting-theme');

        const rewardForm = document.getElementById('settings-reward-form');

        if (priceForm) {
            const currentPrices = db.getPrices();
            priceClear.value = currentPrices.clear;
            priceColor.value = currentPrices.color;
            if(priceMixed) priceMixed.value = currentPrices.mixed;

            priceForm.addEventListener('submit', (e) => {
                e.preventDefault();
                db.setPrices(priceClear.value, priceColor.value, priceMixed ? priceMixed.value : 5);
                alert('อัปเดตราคาสำเร็จ (รีเฟรชหน้าผู้ขายเพื่อดูผลลัพธ์)');
            });
        }

        if (themeForm) {
            themeSelect.value = db.getTheme();
            themeForm.addEventListener('submit', (e) => {
                e.preventDefault();
                db.setTheme(themeSelect.value);
                document.body.setAttribute('data-theme', themeSelect.value);
                alert('เปลี่ยนธีมแอปพลิเคชันสำเร็จ');
            });
        }

        // Reward Management Form
        if (rewardForm) {
            renderAdminRewards();
            
            const cancelBtn = document.getElementById('btn-cancel-reward-edit');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', resetRewardForm);
            }

            rewardForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = document.getElementById('reward-id').value;
                const name = document.getElementById('reward-name').value;
                const cost = parseInt(document.getElementById('reward-cost').value);
                const fileInput = document.getElementById('reward-image');
                
                const processReward = (icon, type) => {
                    if (id) {
                        const existing = db.getRewards().find(r => r.id == id);
                        let updated = { name, cost };
                        if (icon) {
                            updated.icon = icon;
                            updated.type = type;
                        } else if (existing) {
                            updated.icon = existing.icon;
                            updated.type = existing.type;
                        }
                        db.updateReward(id, updated);
                        alert('อัปเดตของรางวัลสำเร็จ!');
                    } else {
                        db.addReward({ name, cost, icon: icon || '🎁', type: type || 'icon' });
                        alert('เพิ่มของรางวัลสำเร็จ!');
                    }
                    resetRewardForm();
                    renderAdminRewards();
                };

                if (fileInput.files && fileInput.files[0]) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        processReward(e.target.result, 'image');
                    };
                    reader.readAsDataURL(fileInput.files[0]);
                } else {
                    processReward(null, null); // Will fallback to existing or default icon
                }
            });
        }
    }

    function resetRewardForm() {
        const rewardForm = document.getElementById('settings-reward-form');
        if(rewardForm) rewardForm.reset();
        const titleEl = document.getElementById('reward-form-title');
        if(titleEl) titleEl.textContent = 'เพิ่มของรางวัลใหม่';
        const submitBtn = document.getElementById('btn-submit-reward');
        if(submitBtn) submitBtn.textContent = 'เพิ่มของรางวัล';
        const cancelBtn = document.getElementById('btn-cancel-reward-edit');
        if(cancelBtn) cancelBtn.style.display = 'none';
        const idInput = document.getElementById('reward-id');
        if(idInput) idInput.value = '';
    }

    function renderAdminRewards() {
        const adminRewardsList = document.getElementById('admin-rewards-list');
        if(!adminRewardsList) return;
        
        const rewards = db.getRewards();
        if(rewards.length === 0) {
            adminRewardsList.innerHTML = '<p class="text-muted">ไม่มีของรางวัลในระบบ</p>';
            return;
        }

        adminRewardsList.innerHTML = rewards.map(r => `
            <div class="reward-card">
                <div class="reward-icon">
                    ${r.type === 'image' ? `<img src="${r.icon}" alt="${r.name}" style="width:100%; height:100%; object-fit:cover;">` : r.icon}
                </div>
                <h4>${r.name}</h4>
                <p>${r.cost} แต้ม</p>
                <div style="display:flex; gap:5px; margin-top:10px; width: 100%;">
                    <button class="btn btn-sm btn-edit-reward" data-id="${r.id}" style="flex:1; background:var(--primary); color:white; padding:4px 8px; border:none; border-radius:4px; cursor:pointer;">แก้ไข</button>
                    <button class="btn btn-sm btn-delete-reward" data-id="${r.id}" style="flex:1; background:var(--danger); color:white; padding:4px 8px; border:none; border-radius:4px; cursor:pointer;">ลบ</button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.btn-edit-reward').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                const reward = db.getRewards().find(r => r.id == id);
                if (reward) {
                    document.getElementById('reward-id').value = reward.id;
                    document.getElementById('reward-name').value = reward.name;
                    document.getElementById('reward-cost').value = reward.cost;
                    
                    const titleEl = document.getElementById('reward-form-title');
                    if(titleEl) titleEl.textContent = 'แก้ไข: ' + reward.name;
                    const submitBtn = document.getElementById('btn-submit-reward');
                    if(submitBtn) submitBtn.textContent = 'บันทึกการแก้ไข';
                    const cancelBtn = document.getElementById('btn-cancel-reward-edit');
                    if(cancelBtn) cancelBtn.style.display = 'block';
                    
                    // scroll to top of card
                    document.getElementById('settings-reward-form').scrollIntoView({behavior: "smooth", block: "center"});
                }
            });
        });

        document.querySelectorAll('.btn-delete-reward').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(confirm('คุณต้องการลบของรางวัลนี้ใช่หรือไม่?')) {
                    const id = e.target.getAttribute('data-id');
                    db.deleteReward(id);
                    renderAdminRewards();
                }
            });
        });
    }

    // --- PDF Export with Preview ---
    function initPdfExport() {
        const exportBtn = document.getElementById('btn-export-pdf');
        const modal = document.getElementById('pdf-preview-modal');
        const closeBtn = document.getElementById('close-pdf-modal');
        const cancelBtn = document.getElementById('btn-cancel-pdf');
        const confirmBtn = document.getElementById('btn-confirm-pdf');
        const previewContent = document.getElementById('pdf-preview-content');

        if (!exportBtn || !modal) return;

        let currentPdfElement = null;
        let pdfFilename = '';

        // Function to build the detailed report HTML
        function buildReportHTML() {
            const dateStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            // Get current overall stats
            const totalBought = document.getElementById('stat-total-bought')?.textContent || '0.0';
            const totalSold = document.getElementById('stat-total-sold')?.textContent || '0.0';
            const totalStock = document.getElementById('stat-total-stock')?.textContent || '0.0';
            const totalProfit = document.getElementById('stat-total-profit')?.textContent || '0.0';

            // Get current filter text
            const filterType = document.getElementById('inv-filter-type');
            const filterText = filterType ? filterType.options[filterType.selectedIndex].text : 'ข้อมูลสะสมทั้งหมด';

            // Get detailed history logs based on current view/filters
            // We'll scrape the current table in the UI, as it's already filtered
            const historyBody = document.getElementById('inventory-history-body');
            let historyRowsHTML = '';
            if (historyBody) {
                historyRowsHTML = historyBody.innerHTML;
            }

            // Create a clean, formatted HTML structure for the PDF
            const reportContainer = document.createElement('div');
            reportContainer.style.fontFamily = "'Kanit', sans-serif";
            reportContainer.style.color = '#333';
            reportContainer.style.padding = '20px';

            reportContainer.innerHTML = `
                <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
                    <h1 style="color: #28a745; margin: 0 0 10px 0; font-size: 28px;">RecycleHub</h1>
                    <h2 style="margin: 0 0 5px 0; font-size: 22px; color: #555;">รายงานสรุปสต็อกสินค้าและผลประกอบการ</h2>
                    <p style="margin: 0; color: #777; font-size: 14px;">พิมพ์เมื่อ: ${dateStr}</p>
                    <p style="margin: 5px 0 0 0; color: #555; font-size: 16px;"><strong>ขอบเขตข้อมูล:</strong> ${filterText}</p>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 30px; background: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #e9ecef;">
                    <div style="text-align: center; flex: 1;">
                        <h4 style="margin: 0 0 10px 0; color: #666;">ซื้อเข้า (กก.)</h4>
                        <div style="font-size: 24px; font-weight: bold; color: #007bff;">${totalBought}</div>
                    </div>
                    <div style="text-align: center; flex: 1; border-left: 1px solid #ddd;">
                        <h4 style="margin: 0 0 10px 0; color: #666;">ขายออก (กก.)</h4>
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${totalSold}</div>
                    </div>
                    <div style="text-align: center; flex: 1; border-left: 1px solid #ddd;">
                        <h4 style="margin: 0 0 10px 0; color: #666;">สต็อกคงเหลือ (กก.)</h4>
                        <div style="font-size: 24px; font-weight: bold; color: #ffc107;">${totalStock}</div>
                    </div>
                    <div style="text-align: center; flex: 1; border-left: 1px solid #ddd;">
                        <h4 style="margin: 0 0 10px 0; color: #666;">กำไร/ขาดทุน (บาท)</h4>
                        <div style="font-size: 24px; font-weight: bold; color: #dc3545;">${totalProfit}</div>
                    </div>
                </div>

                <div style="margin-bottom: 30px;">
                    <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 15px; color: #444;">สรุปสถานะรายประเภท</h3>
                    ${document.getElementById('inventory-overview') ? document.getElementById('inventory-overview').cloneNode(true).innerHTML.replace(/<button[^>]*>.*?<\/button>/gi, '') : '<p>ไม่มีข้อมูลสรุปรายประเภท</p>'}
                </div>

                <div>
                    <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 15px; color: #444;">ประวัติการทำรายการล่าสุด</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead style="background: #f1f3f5;">
                            <tr>
                                <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">วัน/เวลา</th>
                                <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">รายการ</th>
                                <th style="padding: 10px; text-align: left; border: 1px solid #dee2e6;">ประเภท</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #dee2e6;">น้ำหนัก (กก.)</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #dee2e6;">ยอดเงิน (บาท)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${historyRowsHTML.replace(/<td/g, '<td style="padding: 8px 10px; border: 1px solid #dee2e6;"')}
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 50px; text-align: center; color: #888; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
                    <p>เอกสารฉบับนี้สร้างขึ้นโดยระบบอัตโนมัติ RecycleHub</p>
                </div>
            `;

            return reportContainer;
        }

        // Show Preview
        exportBtn.addEventListener('click', () => {
            currentPdfElement = buildReportHTML();
            previewContent.innerHTML = '';
            previewContent.appendChild(currentPdfElement);
            
            pdfFilename = `RecycleHub_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            
            modal.style.display = 'block';
        });

        // Close Modal Handlers
        const closeModal = () => {
            modal.style.display = 'none';
        };

        if(closeBtn) closeBtn.addEventListener('click', closeModal);
        if(cancelBtn) cancelBtn.addEventListener('click', closeModal);
        window.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Generate PDF
        confirmBtn.addEventListener('click', () => {
            if (!currentPdfElement) return;

            const originalText = confirmBtn.innerHTML;
            confirmBtn.innerHTML = '<span>⏳</span> กำลังส่งออก...';
            confirmBtn.disabled = true;

            const opt = {
                margin:       [10, 10, 10, 10],
                filename:     pdfFilename,
                image:        { type: 'jpeg', quality: 0.98 },
                html2canvas:  { scale: 2, useCORS: true, logging: false },
                jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            html2pdf().set(opt).from(currentPdfElement).save().then(() => {
                confirmBtn.innerHTML = originalText;
                confirmBtn.disabled = false;
                closeModal();
            }).catch(err => {
                console.error("PDF Export Error:", err);
                alert("เกิดข้อผิดพลาดในการสร้าง PDF: " + err.message);
                confirmBtn.innerHTML = originalText;
                confirmBtn.disabled = false;
            });
        });
    }

    init();
    initPdfExport();
});
