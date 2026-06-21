import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Constants ──────────────────────────────────────────────────────────────
const EARTH_RADIUS = 1;
const CLOUD_RADIUS = 1.01;
const ATMO_RADIUS = 1.15;
const STAR_COUNT = 12000;

// ── Global state ───────────────────────────────────────────────────────────
let scene, camera, renderer, controls, clock;
let earthMesh, cloudMesh, atmosphereMesh, starField;
let countryLinesMesh;
let flightGroup;
let raycaster, mouse;
let hoveredCountryId = null;
let nightMode = false;

const countryData = {};
let geoJsonFeatures = [];
const loadProgress = { textures: 0, geojson: 0, total: 2 };

// ── Boot ───────────────────────────────────────────────────────────────────
init();

async function init() {
  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2(-999, -999);

  createScene();
  createStarfield();
  createEarth();
  createAtmosphere();
  createClouds();
  createHighlightSphere();
  setupLighting();
  setupControls();
  setupEventListeners();
  loadCountryData();

  animate();
}

// ── Scene ──────────────────────────────────────────────────────────────────
function createScene() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.getElementById('globe-container').appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0.5, 2.8);
}

function createStarfield() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const r = 80 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.85 });
  starField = new THREE.Points(geo, mat);
  scene.add(starField);
}

// ── Earth ──────────────────────────────────────────────────────────────────
function createEarth() {
  const loader = new THREE.TextureLoader();
  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 96, 64);
  const earthMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
  earthMesh = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earthMesh);

  loader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    earthMat.map = tex; earthMat.needsUpdate = true;
    onAssetLoaded('textures');
  }, undefined, () => onAssetLoaded('textures'));

  loader.load('https://unpkg.com/three-globe/example/img/earth-topology.png', (tex) => {
    earthMat.bumpMap = tex; earthMat.bumpScale = 0.015; earthMat.needsUpdate = true;
  });

  loader.load('https://unpkg.com/three-globe/example/img/earth-water.png', (tex) => {
    earthMat.roughnessMap = tex; earthMat.needsUpdate = true;
  });

  loader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    earthMesh.userData.nightTex = tex;
  });
}

// ── Atmosphere ─────────────────────────────────────────────────────────────
function createAtmosphere() {
  const atmoGeo = new THREE.SphereGeometry(ATMO_RADIUS, 64, 64);
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity * 0.9;
      }
    `,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  atmosphereMesh = new THREE.Mesh(atmoGeo, atmoMat);
  scene.add(atmosphereMesh);
}

// ── Clouds ─────────────────────────────────────────────────────────────────
function createClouds() {
  const cloudGeo = new THREE.SphereGeometry(CLOUD_RADIUS, 80, 40);
  const cloudMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
  cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  scene.add(cloudMesh);

  new THREE.TextureLoader().load('https://unpkg.com/three-globe/example/img/earth-clouds.png', (tex) => {
    cloudMat.alphaMap = tex; cloudMat.needsUpdate = true;
  });
}

// ── Country highlight overlay ──────────────────────────────────────────────
function createHighlightSphere() {
  // A slightly larger transparent sphere used to show country highlight via a custom shader
  // that reads from a data texture marking which country is hovered.
  // Simpler approach: we'll just draw the highlighted country outline thicker + a fill.
  // We'll create the highlight dynamically when a country is hovered.
}

// ── Lighting ───────────────────────────────────────────────────────────────
function setupLighting() {
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 3, 5);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x334466, 0.6));
  const fill = new THREE.DirectionalLight(0x4488cc, 0.3);
  fill.position.set(-5, -2, -5);
  scene.add(fill);
}

// ── OrbitControls ──────────────────────────────────────────────────────────
function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.15;
  controls.maxDistance = 8;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  controls.enablePan = false;
}

// ── Country data ───────────────────────────────────────────────────────────
async function loadCountryData() {
  updateLoadStatus('Loading country boundaries…');
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const world = await resp.json();

    // Load topojson-client dynamically
    await loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js');

    const countriesGeo = topojson.feature(world, world.objects.countries);
    processGeoJsonCountries(countriesGeo);
    onAssetLoaded('geojson');
  } catch (e) {
    console.warn('Failed to load country data:', e);
    onAssetLoaded('geojson');
  }

  loadCountryStats();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function loadCountryStats() {
  try {
    const resp = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,cca3,capital,population,area,region,subregion,flags');
    const data = await resp.json();
    for (const c of data) {
      const id = c.cca3 || c.cca2;
      countryData[id] = {
        name: c.name?.common || id,
        capital: c.capital?.[0] || '—',
        population: c.population || 0,
        area: c.area || 0,
        region: c.region || '—',
        flag: c.flags?.svg || '',
        gdp: 0,
      };
    }
    patchGDP();
  } catch (e) {
    console.warn('Failed to load country stats:', e);
  }
}

function patchGDP() {
  const gdpData = {
    USA:25462700,CHN:17963171,JPN:4231141,DEU:4072192,GBR:3070668,
    IND:3385090,FRA:2782905,ITA:2010431,CAN:2139840,BRA:1920096,
    RUS:2240422,KOR:1665246,AUS:1675419,ESP:1397870,MEX:1322681,
    IDN:1319100,NLD:1009021,SAU:1108149,TUR:905988,CHE:807706,
    POL:688177,SWE:585939,ARG:632770,NOR:579267,ISR:525004,
    IRL:529175,AUT:471404,THA:495348,SGP:397011,NGA:477386,
    EGY:404143,ZAF:399016,MYS:407026,PHL:404284,VNM:408808,
    BGD:416265,PAK:348263,CHL:300742,COL:343618,CZE:290922,
    ROU:301258,NZL:247235,PER:242624,PRT:251925,FIN:282640,
    UKR:160502,KAZ:220622,HUN:188493,QAT:221369,KWT:184617,
    SWE:585939,DNK:395404,NOR:579267,PHL:404284,
  };
  for (const [id, d] of Object.entries(countryData)) {
    d.gdp = gdpData[id] || 0;
  }
}

// ── Build country borders and index ────────────────────────────────────────
function processGeoJsonCountries(geojson) {
  const linePoints = [];
  geoJsonFeatures = [];

  for (const feature of geojson.features) {
    const id = feature.id || feature.properties?.name;
    const geom = feature.geometry;
    if (!geom) continue;

    const polygons = [];
    const coords = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];

    for (const polygon of coords) {
      const ring = polygon[0]; // outer ring
      // Store polygon for point-in-polygon testing (as [lon,lat] pairs)
      polygons.push(ring.map(c => c));

      // Build border lines
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        const p1 = latLonToVec3(lat1, lon1, EARTH_RADIUS + 0.002);
        const p2 = latLonToVec3(lat2, lon2, EARTH_RADIUS + 0.002);
        linePoints.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }

    geoJsonFeatures.push({ id, polygons, name: feature.properties?.name || String(id) });
  }

  // Build border lines
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4d9fff, transparent: true, opacity: 0.2, depthTest: true });
  countryLinesMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(countryLinesMesh);
}

// ── Point-in-polygon (ray casting) ─────────────────────────────────────────
function pointInPolygon(lon, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findCountryAt(lat, lon) {
  for (const feature of geoJsonFeatures) {
    for (const polygon of feature.polygons) {
      if (pointInPolygon(lon, lat, polygon)) {
        return feature;
      }
    }
  }
  return null;
}

// ── Country highlight ──────────────────────────────────────────────────────
let highlightLineMesh = null;
let highlightFillMesh = null;

function highlightCountry(feature) {
  clearHighlight();
  if (!feature) return;

  const linePoints = [];
  const fillVerts = [];
  const fillIndices = [];

  const polygons = feature.polygons;

  for (const ring of polygons) {
    // Border lines (thicker appearance via double lines)
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      const p1 = latLonToVec3(lat1, lon1, EARTH_RADIUS + 0.004);
      const p2 = latLonToVec3(lat2, lon2, EARTH_RADIUS + 0.004);
      linePoints.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    // Fill: create a triangle fan from centroid
    const r = EARTH_RADIUS + 0.003;
    let cx = 0, cy = 0, cz = 0;
    const vecs = ring.map(([lon, lat]) => {
      const v = latLonToVec3(lat, lon, r);
      cx += v.x; cy += v.y; cz += v.z;
      return v;
    });
    const n = vecs.length;
    cx /= n; cy /= n; cz /= n;
    const centroid = new THREE.Vector3(cx, cy, cz).normalize().multiplyScalar(r);

    const baseIdx = fillVerts.length / 3;
    fillVerts.push(centroid.x, centroid.y, centroid.z);
    for (const v of vecs) {
      fillVerts.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < n; i++) {
      fillIndices.push(baseIdx, baseIdx + 1 + i, baseIdx + 1 + ((i + 1) % n));
    }
  }

  // Highlight border
  if (linePoints.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    highlightLineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x4d9fff, transparent: true, opacity: 0.9, depthTest: true, linewidth: 2,
    }));
    scene.add(highlightLineMesh);
  }

  // Highlight fill
  if (fillVerts.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));
    geo.setIndex(fillIndices);
    geo.computeVertexNormals();
    highlightFillMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x4d9fff, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false,
    }));
    scene.add(highlightFillMesh);
  }
}

function clearHighlight() {
  if (highlightLineMesh) { scene.remove(highlightLineMesh); highlightLineMesh.geometry.dispose(); highlightLineMesh = null; }
  if (highlightFillMesh) { scene.remove(highlightFillMesh); highlightFillMesh.geometry.dispose(); highlightFillMesh = null; }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
     radius * Math.cos(phi),
     radius * Math.sin(phi) * Math.sin(theta)
  );
}

function vec3ToLatLon(v) {
  const r = v.length();
  const lat = 90 - Math.acos(v.y / r) * (180 / Math.PI);
  const lon = ((Math.atan2(v.z, -v.x) * 180 / Math.PI) - 180 + 360) % 360 - 180;
  return { lat, lon };
}

function formatNumber(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatArea(km2) {
  if (km2 >= 1e6) return (km2 / 1e6).toFixed(2) + 'M km²';
  if (km2 >= 1e3) return (km2 / 1e3).toFixed(1) + 'K km²';
  return km2.toLocaleString() + ' km²';
}

// ── Flight traffic ─────────────────────────────────────────────────────────
const AIRPORTS = [
  { name:'JFK', lat:40.64, lon:-73.78 }, { name:'LHR', lat:51.47, lon:-0.46 },
  { name:'CDG', lat:49.01, lon:2.55 },   { name:'DXB', lat:25.25, lon:55.36 },
  { name:'HND', lat:35.55, lon:139.78 }, { name:'LAX', lat:33.94, lon:-118.41 },
  { name:'SIN', lat:1.36, lon:103.99 },  { name:'SYD', lat:-33.95, lon:151.18 },
  { name:'PEK', lat:40.08, lon:116.59 }, { name:'ORD', lat:41.97, lon:-87.91 },
  { name:'ATL', lat:33.64, lon:-84.43 }, { name:'IST', lat:41.26, lon:28.74 },
  { name:'FRA', lat:50.03, lon:8.57 },   { name:'ICN', lat:37.46, lon:126.44 },
  { name:'AMS', lat:52.31, lon:4.77 },   { name:'MAD', lat:40.49, lon:-3.57 },
  { name:'BKK', lat:13.68, lon:100.75 }, { name:'GRU', lat:-23.43, lon:-46.47 },
  { name:'DEL', lat:28.57, lon:77.10 },  { name:'MEX', lat:19.44, lon:-99.07 },
];

const FLIGHT_ROUTES = [
  [0,1],[0,2],[0,3],[0,5],[0,9],[0,10],[1,2],[1,3],[1,6],[1,8],[1,12],
  [2,3],[2,11],[2,6],[3,6],[3,7],[3,8],[3,18],[4,6],[4,8],[4,13],
  [5,7],[5,9],[5,10],[5,19],[6,7],[6,16],[6,4],[8,13],[8,18],[9,10],
  [11,3],[11,12],[12,14],[14,15],[15,2],[16,6],[17,0],[17,2],[18,3],[18,6],
  [19,3],[19,17],[1,14],[0,19],[7,6],[5,4],[10,1],[9,4],
];

function createFlightArcs() {
  flightGroup = new THREE.Group();
  flightGroup.visible = false;

  for (const [fi, ti] of FLIGHT_ROUTES) {
    const from = AIRPORTS[fi], to = AIRPORTS[ti];
    const start = latLonToVec3(from.lat, from.lon, EARTH_RADIUS + 0.005);
    const end = latLonToVec3(to.lat, to.lon, EARTH_RADIUS + 0.005);
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const dist = start.distanceTo(end);
    mid.normalize().multiplyScalar(EARTH_RADIUS + dist * 0.35);

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const pts = curve.getPoints(60);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffaa33, transparent: true, opacity: 0.4, depthTest: true,
    }));
    flightGroup.add(line);

    // Animated dot
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcc44 })
    );
    dot.userData = { curve, t: Math.random(), speed: 0.001 + Math.random() * 0.002 };
    flightGroup.add(dot);
  }

  scene.add(flightGroup);
}

function updateFlightDots() {
  if (!flightGroup || !flightGroup.visible) return;
  for (const child of flightGroup.children) {
    if (child.userData.curve) {
      child.userData.t = (child.userData.t + child.userData.speed) % 1;
      child.position.copy(child.userData.curve.getPoint(child.userData.t));
    }
  }
}

// ── Events ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mousedown', () => { controls.autoRotate = false; });
  renderer.domElement.addEventListener('wheel', () => { controls.autoRotate = false; });

  document.getElementById('toggle-clouds').addEventListener('change', (e) => {
    if (cloudMesh) cloudMesh.visible = e.target.checked;
  });
  document.getElementById('toggle-flights').addEventListener('change', (e) => {
    if (!flightGroup) createFlightArcs();
    flightGroup.visible = e.target.checked;
  });
  document.getElementById('toggle-night').addEventListener('change', (e) => {
    nightMode = e.target.checked;
    applyNightMode(nightMode);
  });
  document.getElementById('toggle-borders').addEventListener('change', (e) => {
    if (countryLinesMesh) countryLinesMesh.visible = e.target.checked;
  });
  document.getElementById('toggle-atmosphere').addEventListener('change', (e) => {
    if (atmosphereMesh) atmosphereMesh.visible = e.target.checked;
  });
}

function onMouseMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(earthMesh);

  const popup = document.getElementById('country-popup');

  if (hits.length > 0) {
    const { lat, lon } = vec3ToLatLon(hits[0].point);
    document.getElementById('coords-display').textContent = `Lat: ${lat.toFixed(2)}° Lon: ${lon.toFixed(2)}°`;

    const feature = findCountryAt(lat, lon);
    if (feature && feature.id !== hoveredCountryId) {
      hoveredCountryId = feature.id;
      highlightCountry(feature);
      showPopup(feature, e);
    } else if (feature) {
      // Just update popup position
      positionPopup(e);
    } else {
      hoveredCountryId = null;
      clearHighlight();
      popup.classList.add('hidden');
      renderer.domElement.style.cursor = 'grab';
    }

    if (feature) {
      renderer.domElement.style.cursor = 'pointer';
    }
  } else {
    if (hoveredCountryId !== null) {
      hoveredCountryId = null;
      clearHighlight();
      popup.classList.add('hidden');
    }
    renderer.domElement.style.cursor = 'grab';
  }
}

function showPopup(feature, e) {
  const stats = getCountryStats(feature.id, feature.name);
  document.getElementById('popup-name').textContent = stats.name;
  document.getElementById('popup-flag').innerHTML = stats.flag ? `<img src="${stats.flag}" style="width:24px;height:16px;border-radius:2px;">` : '';
  document.getElementById('popup-capital').textContent = stats.capital;
  document.getElementById('popup-population').textContent = formatNumber(stats.population);
  document.getElementById('popup-area').textContent = formatArea(stats.area);
  document.getElementById('popup-gdp').textContent = stats.gdp > 0 ? `$${formatNumber(stats.gdp)}` : '—';
  document.getElementById('popup-region').textContent = stats.region;
  document.getElementById('country-popup').classList.remove('hidden');
  positionPopup(e);
}

function positionPopup(e) {
  const popup = document.getElementById('country-popup');
  const px = e.clientX + 20;
  const py = e.clientY - 10;
  popup.style.left = Math.min(px, window.innerWidth - 280) + 'px';
  popup.style.top = Math.min(py, window.innerHeight - 200) + 'px';
}

function getCountryStats(id, fallbackName) {
  const numericToAlpha3 = {
    '4':'AFG','8':'ALB','12':'DZA','16':'ASM','20':'AND','24':'AGO',
    '28':'ATG','31':'AZE','32':'ARG','36':'AUS','40':'AUT','44':'BHS',
    '48':'BHR','50':'BGD','51':'ARM','52':'BRB','56':'BEL','60':'BMU',
    '64':'BTN','68':'BOL','70':'BIH','72':'BWA','76':'BRA','84':'BLZ',
    '90':'SLB','96':'BRN','100':'BGR','104':'MMR','108':'BDI','112':'BLR',
    '116':'KHM','120':'CMR','124':'CAN','132':'CPV','140':'CAF','144':'LKA',
    '148':'TCD','152':'CHL','156':'CHN','158':'TWN','170':'COL','174':'COM',
    '178':'COG','180':'COD','188':'CRI','191':'HRV','192':'CUB','196':'CYP',
    '203':'CZE','204':'BEN','208':'DNK','212':'DMA','214':'DOM','218':'ECU',
    '222':'SLV','226':'GNQ','231':'ETH','232':'ERI','233':'EST','234':'FRO',
    '242':'FJI','246':'FIN','250':'FRA','258':'PYF','262':'DJI','266':'GAB',
    '268':'GEO','270':'GMB','275':'PSE','276':'DEU','288':'GHA','296':'KIR',
    '300':'GRC','304':'GRL','308':'GRD','320':'GTM','324':'GIN','328':'GUY',
    '332':'HTI','340':'HND','344':'HKG','348':'HUN','352':'ISL','356':'IND',
    '360':'IDN','364':'IRN','368':'IRQ','372':'IRL','376':'ISR','380':'ITA',
    '384':'CIV','388':'JAM','392':'JPN','398':'KAZ','400':'JOR','404':'KEN',
    '408':'PRK','410':'KOR','414':'KWT','417':'KGZ','418':'LAO','422':'LBN',
    '426':'LSO','428':'LVA','430':'LBR','434':'LBY','438':'LIE','440':'LTU',
    '442':'LUX','450':'MDG','454':'MWI','458':'MYS','462':'MDV','466':'MLI',
    '470':'MLT','478':'MRT','480':'MUS','484':'MEX','492':'MCO','496':'MNG',
    '498':'MDA','499':'MNE','504':'MAR','508':'MOZ','512':'OMN','516':'NAM',
    '520':'NRU','524':'NPL','528':'NLD','540':'NCL','548':'VUT','554':'NZL',
    '558':'NIC','562':'NER','566':'NGA','570':'NIU','578':'NOR','580':'MNP',
    '583':'FSM','584':'MHL','585':'PLW','586':'PAK','591':'PAN','598':'PNG',
    '600':'PRY','604':'PER','608':'PHL','616':'POL','620':'PRT','624':'GNB',
    '626':'TLS','630':'PRI','634':'QAT','642':'ROU','643':'RUS','646':'RWA',
    '682':'SAU','686':'SEN','688':'SRB','694':'SLE','702':'SGP','703':'SVK',
    '704':'VNM','705':'SVN','706':'SOM','710':'ZAF','716':'ZWE','724':'ESP',
    '728':'SSD','729':'SDN','732':'ESH','740':'SUR','748':'SWZ','752':'SWE',
    '756':'CHE','760':'SYR','762':'TJK','764':'THA','768':'TGO','776':'TUN',
    '780':'TTO','784':'ARE','788':'TZA','792':'TUR','795':'TKM','800':'UGA',
    '804':'UKR','807':'MKD','818':'EGY','826':'GBR','834':'TZA','840':'USA',
    '854':'BFA','858':'URY','860':'UZB','862':'VEN','876':'WLF','882':'WSM',
    '887':'YEM','894':'ZMB',
  };

  const alpha3 = numericToAlpha3[String(id)];
  if (alpha3 && countryData[alpha3]) return countryData[alpha3];
  return { name: fallbackName || String(id), capital: '—', population: 0, area: 0, gdp: 0, region: '—', flag: '' };
}

// ── Night mode ─────────────────────────────────────────────────────────────
function applyNightMode(on) {
  if (!earthMesh) return;
  const mat = earthMesh.material;
  if (on && earthMesh.userData.nightTex) {
    mat.emissiveMap = earthMesh.userData.nightTex;
    mat.emissive = new THREE.Color(0xffcc88);
    mat.emissiveIntensity = 1.8;
  } else {
    mat.emissiveMap = null;
    mat.emissive = new THREE.Color(0x000000);
    mat.emissiveIntensity = 0;
  }
  mat.needsUpdate = true;
}

// ── Loading ────────────────────────────────────────────────────────────────
function onAssetLoaded(key) {
  loadProgress[key] = 1;
  const pct = ((loadProgress.textures + loadProgress.geojson) / loadProgress.total) * 100;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = pct + '%';
  updateLoadStatus(`Loaded ${key}…`);

  if (loadProgress.textures + loadProgress.geojson >= loadProgress.total) {
    setTimeout(() => {
      const screen = document.getElementById('loading-screen');
      if (screen) {
        screen.classList.add('fade-out');
        setTimeout(() => screen.remove(), 600);
      }
    }, 400);
  }
}

function updateLoadStatus(msg) {
  const el = document.getElementById('load-status');
  if (el) el.textContent = msg;
}

// ── Animation loop ─────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  controls.update();

  if (cloudMesh && cloudMesh.visible) cloudMesh.rotation.y += dt * 0.01;
  updateFlightDots();

  const dist = camera.position.length();
  const zoom = (8 / dist).toFixed(1);
  document.getElementById('zoom-level').textContent = `Zoom: ${zoom}×`;

  renderer.render(scene, camera);
}
