import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let globeGroup, coreMesh; 
let pin = null;
let raycaster, mouse;

const container = document.getElementById('globe-container');
const weatherCard = document.getElementById('weather-card');
const cardLoader = document.getElementById('card-loader');
const cardContent = document.getElementById('card-content');
const closeBtn = document.getElementById('close-btn');

let isCardOpen = false;
let isDragging = false;

const weatherCodeMap = {
    0: { desc: "Clear Sky", icon: "☀️" },
    1: { desc: "Mainly Clear", icon: "🌤️" },
    2: { desc: "Partly Cloudy", icon: "⛅" },
    3: { desc: "Overcast", icon: "☁️" },
    45: { desc: "Foggy", icon: "🌫️" },
    48: { desc: "Rime Fog", icon: "🌫️" },
    51: { desc: "Light Drizzle", icon: "🌦️" },
    53: { desc: "Moderate Drizzle", icon: "🌦️" },
    55: { desc: "Dense Drizzle", icon: "🌦️" },
    61: { desc: "Slight Rain", icon: "🌧️" },
    63: { desc: "Moderate Rain", icon: "🌧️" },
    65: { desc: "Heavy Rain", icon: "🌧️" },
    71: { desc: "Slight Snowfall", icon: "🌨️" },
    73: { desc: "Moderate Snowfall", icon: "🌨️" },
    75: { desc: "Heavy Snowfall", icon: "🌨️" },
    80: { desc: "Slight Showers", icon: "🌦️" },
    81: { desc: "Moderate Showers", icon: "🌧️" },
    82: { desc: "Violent Showers", icon: "⛈️" },
    95: { desc: "Thunderstorm", icon: "⚡" },
    96: { desc: "Storm with Hail", icon: "⛈️" },
    99: { desc: "Severe Storm", icon: "💥" }
};

// --- Core Trigonometry Mapping ---
function latLonToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    return new THREE.Vector3(x, y, z);
}

function vector3ToLatLon(vector) {
    const normalized = vector.clone().normalize();
    const lat = 90 - (Math.acos(normalized.y) * 180 / Math.PI);
    let lon = ((Math.atan2(normalized.z, -normalized.x) * 180 / Math.PI)) - 180;
    
    while (lon < -180) lon += 360;
    while (lon > 180) lon -= 360;
    
    return { lat, lon };
}

// --- Initialization ---
function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 15;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 6;
    controls.maxDistance = 25;

    controls.addEventListener('start', () => isDragging = true);
    controls.addEventListener('end', () => isDragging = false);

    globeGroup = new THREE.Group();
    scene.add(globeGroup);

    const globeRadius = 5;
    
    // 1. Transparent Dark Core (Allows seeing through to the back lines)
    const coreGeo = new THREE.SphereGeometry(globeRadius, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0x050608,
        transparent: true,
        opacity: 0.75 
    });
    coreMesh = new THREE.Mesh(coreGeo, coreMat);
    globeGroup.add(coreMesh);

    // 2. Structural Wireframe Overlay
    const wireGeo = new THREE.SphereGeometry(globeRadius + 0.005, 30, 20);
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0xff0055,
        wireframe: true,
        transparent: true,
        opacity: 0.15
    });
    const gridGlobe = new THREE.Mesh(wireGeo, wireMat);
    globeGroup.add(gridGlobe);

    // 3. Cyber Particles
    const particleCount = 1000;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = globeRadius + 0.03; 

        positions[i] = r * Math.sin(phi) * Math.sin(theta);
        positions[i + 1] = r * Math.cos(phi);
        positions[i + 2] = r * Math.sin(phi) * Math.cos(theta);
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
        color: 0xfcee0a,
        size: 0.04,
        transparent: true,
        opacity: 0.6
    });
    const atmosphericGlow = new THREE.Points(particleGeo, particleMat);
    globeGroup.add(atmosphericGlow);

    // 4. Procedural Map & Texture
    buildVectorMap(globeRadius + 0.01);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('pointerdown', onPointerDown);
    closeBtn.addEventListener('click', closeWeatherCard);

    animate();
}

// --- Dynamic GeoJSON Map Generation ---
async function buildVectorMap(radius) {
    try {
        const response = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
        const data = await response.json();
        
        // 1. Draw the highly visible 3D Cyan Outlines
        const material = new THREE.LineBasicMaterial({
            color: 0x00f3ff,
            transparent: true,
            opacity: 0.6
        });

        const points = [];

        data.features.forEach(feature => {
            const geometry = feature.geometry;
            if (!geometry) return;

            if (geometry.type === 'Polygon') {
                geometry.coordinates.forEach(ring => {
                    for (let i = 0; i < ring.length - 1; i++) {
                        points.push(
                            latLonToVector3(ring[i][1], ring[i][0], radius),
                            latLonToVector3(ring[i+1][1], ring[i+1][0], radius)
                        );
                    }
                });
            } else if (geometry.type === 'MultiPolygon') {
                geometry.coordinates.forEach(polygon => {
                    polygon.forEach(ring => {
                        for (let i = 0; i < ring.length - 1; i++) {
                            points.push(
                                latLonToVector3(ring[i][1], ring[i][0], radius),
                                latLonToVector3(ring[i+1][1], ring[i+1][0], radius)
                            );
                        }
                    });
                });
            }
        });

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const vectorMap = new THREE.LineSegments(lineGeometry, material);
        globeGroup.add(vectorMap);

        // 2. Dynamically import D3 to generate semi-transparent colored landmasses
        const d3 = await import('https://cdn.jsdelivr.net/npm/d3@7/+esm');

        const canvas = document.createElement('canvas');
        canvas.width = 4096; 
        canvas.height = 2048;
        const ctx = canvas.getContext('2d');

        // Ensure oceans are 100% transparent
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const projection = d3.geoEquirectangular()
            .translate([canvas.width / 2, canvas.height / 2])
            .scale(canvas.width / (2 * Math.PI));
        
        const pathGenerator = d3.geoPath().projection(projection).context(ctx);

        // Cyberpunk neon colors with low opacity for a holographic look
        const cyberColors = [
            'rgba(0, 243, 255, 0.12)',   // Transparent Cyan
            'rgba(255, 0, 85, 0.1)',     // Transparent Pink
            'rgba(252, 238, 10, 0.1)',   // Transparent Yellow
            'rgba(18, 226, 163, 0.1)'    // Transparent Neon Green
        ];

        data.features.forEach((feature, i) => {
            ctx.beginPath();
            pathGenerator(feature);
            ctx.fillStyle = cyberColors[i % cyberColors.length];
            ctx.fill();
        });

        const mapTexture = new THREE.CanvasTexture(canvas);
        mapTexture.needsUpdate = true;
        mapTexture.flipY = true; // Lock orientation to match ThreeJS sphere defaults
        
        // 3. Apply the colored landmasses to an invisible outer sphere
        const mapMat = new THREE.MeshBasicMaterial({
            map: mapTexture,
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide
        });
        
        const landMesh = new THREE.Mesh(new THREE.SphereGeometry(radius - 0.005, 64, 64), mapMat);
        // CRITICAL FIX: The rogue -90 degree rotation has been removed.
        // landMesh.rotation.y = 0 by default, aligning perfectly with the cyan vectors.
        globeGroup.add(landMesh);

    } catch (err) {
        console.error("Vector map generation failed: ", err);
    }
}

// --- Interaction Logic Mechanics ---
let pointerStartX = 0;
let pointerStartY = 0;

function onPointerDown(event) {
    if (weatherCard.contains(event.target)) return;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    window.addEventListener('pointerup', onPointerUp);
}

function onPointerUp(event) {
    window.removeEventListener('pointerup', onPointerUp);

    const deltaX = Math.abs(event.clientX - pointerStartX);
    const deltaY = Math.abs(event.clientY - pointerStartY);

    if (deltaX < 4 && deltaY < 4) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        
        // Raycast targets the solid inner core to calculate hit coordinates
        const intersects = raycaster.intersectObject(coreMesh);

        if (intersects.length > 0) {
            const hitPoint = intersects[0].point; 
            const localPoint = globeGroup.worldToLocal(hitPoint.clone());
            handleGlobeSelection(localPoint);
        }
    }
}

function handleGlobeSelection(localPoint) {
    if (pin) globeGroup.remove(pin);

    // CRITICAL FIX: Shrunk the radius from 0.08 to 0.015 for a precise tactical ping
    const pinGeo = new THREE.SphereGeometry(0.015, 23, 23);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    pin = new THREE.Mesh(pinGeo, pinMat);
    pin.position.copy(localPoint);
    globeGroup.add(pin);

    const { lat, lon } = vector3ToLatLon(localPoint);

    openWeatherCard();
    fetchWeatherData(lat, lon);
}

// --- API Network Controller ---
async function fetchWeatherData(lat, lon) {
    cardLoader.classList.remove('hidden');
    cardContent.classList.add('hidden');

    document.getElementById('lat-lon-display').innerText = 
        `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    document.getElementById('location-name').innerText = "Targeting satellite...";

    try {
        const geoResponse = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        const geoData = await geoResponse.json();
        
        let locName = "Uncharted Sector (Ocean)";
        if (geoData.city || geoData.locality || geoData.countryName) {
            const city = geoData.city || geoData.locality || geoData.principalSubdivision || "";
            const country = geoData.countryName || "";
            locName = city ? `${city}, ${country}` : country; 
        }
        document.getElementById('location-name').innerText = locName;

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`;
        const weatherResponse = await fetch(weatherUrl);
        
        if (!weatherResponse.ok) throw new Error("Network data stream exception.");
        
        const weatherData = await weatherResponse.json();
        populateCardDetails(weatherData.current);
    } catch (error) {
        document.getElementById('weather-status').innerText = "Matrix Connection Error";
        cardLoader.innerText = "Failed to synchronize spatial atmospheric data.";
    }
}

function populateCardDetails(current) {
    const codeData = weatherCodeMap[current.weather_code] || { desc: "Unknown State", icon: "🌀" };
    
    document.getElementById('weather-status').innerText = codeData.desc;
    document.getElementById('weather-icon').innerText = codeData.icon;
    document.getElementById('temp-display').innerText = Math.round(current.temperature_2m);
    document.getElementById('feels-like').innerText = `${Math.round(current.apparent_temperature)}°C`;
    document.getElementById('wind-speed').innerText = `${current.wind_speed_10m} km/h`;
    document.getElementById('humidity').innerText = `${current.relative_humidity_2m}%`;
    document.getElementById('precipitation').innerText = `${current.precipitation} mm`;

    cardLoader.classList.add('hidden');
    cardContent.classList.remove('hidden');
}

// --- UI Display & Tracking Matrix ---
function openWeatherCard() {
    isCardOpen = true;
    weatherCard.classList.remove('hidden');
    updateCardScreenPosition();
}

function closeWeatherCard() {
    isCardOpen = false;
    weatherCard.classList.add('hidden');
    
    weatherCard.style.opacity = "0";
    weatherCard.style.pointerEvents = "none";
    
    if (pin) {
        globeGroup.remove(pin);
        pin = null;
    }
}

function updateCardScreenPosition() {
    if (!pin || !isCardOpen) return;

    const pinWorldPos = new THREE.Vector3();
    pin.getWorldPosition(pinWorldPos);
    
    const projectionVector = pinWorldPos.clone();
    projectionVector.project(camera);

    const pinNormal = pinWorldPos.clone().normalize();
    const cameraToPin = camera.position.clone().sub(pinWorldPos).normalize();

    if (pinNormal.dot(cameraToPin) > 0.15) {
        const pixelX = (projectionVector.x * .5 + .5) * window.innerWidth;
        const pixelY = (-(projectionVector.y * .5) + .5) * window.innerHeight;

        weatherCard.style.left = `${pixelX}px`;
        weatherCard.style.top = `${pixelY}px`;
        weatherCard.style.opacity = "1";
        weatherCard.style.pointerEvents = "auto";
    } else {
        weatherCard.style.opacity = "0";
        weatherCard.style.pointerEvents = "none";
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Render Engine Loop ---
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    updateCardScreenPosition(); 
    renderer.render(scene, camera);
}

init();