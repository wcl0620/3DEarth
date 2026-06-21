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

let geoJsonFeatures = [];
const loadProgress = { textures: 0, geojson: 0, total: 2 };

// Country lookup grid: maps [lat_idx][lon_idx] -> feature index
const GRID_STEP = 1; // 1 degree resolution
const GRID_LAT_SIZE = 180;
const GRID_LON_SIZE = 360;
let countryGrid = null;

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
// Static dataset keyed by world-atlas numeric IDs (3-digit padded strings)
// Source: UN / World Bank 2023 estimates — no external API needed
const COUNTRIES = {
  '004':{n:'Afghanistan',c:'Kabul',p:41128771,a:652230,g:14394,r:'Asia'},
  '008':{n:'Albania',c:'Tirana',p:2877397,a:28748,g:18817,r:'Europe'},
  '010':{n:'Antarctica',c:'—',p:1100,a:14200000,g:0,r:'Antarctica'},
  '012':{n:'Algeria',c:'Algiers',p:44903225,a:2381741,g:187017,r:'Africa'},
  '016':{n:'American Samoa',c:'Pago Pago',p:55197,a:199,g:711,r:'Oceania'},
  '020':{n:'Andorra',c:'Andorra la Vella',p:79034,a:468,g:3317,r:'Europe'},
  '024':{n:'Angola',c:'Luanda',p:35027343,a:1246700,g:106726,r:'Africa'},
  '028':{n:'Antigua and Barbuda',c:"St. John's",p:93219,a:442,g:1710,r:'Americas'},
  '031':{n:'Azerbaijan',c:'Baku',p:10139177,a:86600,g:54622,r:'Asia'},
  '032':{n:'Argentina',c:'Buenos Aires',p:45808747,a:2780400,g:632770,r:'Americas'},
  '036':{n:'Australia',c:'Canberra',p:26439111,a:7692024,g:1675419,r:'Oceania'},
  '040':{n:'Austria',c:'Vienna',p:9104772,a:83871,g:471404,r:'Europe'},
  '044':{n:'Bahamas',c:'Nassau',p:409984,a:13943,g:12917,r:'Americas'},
  '048':{n:'Bahrain',c:'Manama',p:1489835,a:765,g:44389,r:'Asia'},
  '050':{n:'Bangladesh',c:'Dhaka',p:172954319,a:147570,g:416265,r:'Asia'},
  '051':{n:'Armenia',c:'Yerevan',p:2827727,a:29743,g:19531,r:'Asia'},
  '052':{n:'Barbados',c:'Bridgetown',p:281995,a:431,g:5214,r:'Americas'},
  '056':{n:'Belgium',c:'Brussels',p:11686140,a:30528,g:578635,r:'Europe'},
  '060':{n:'Bermuda',c:'Hamilton',p:64069,a:54,g:7383,r:'Americas'},
  '064':{n:'Bhutan',c:'Thimphu',p:782318,a:38394,g:2562,r:'Asia'},
  '068':{n:'Bolivia',c:'Sucre',p:12224110,a:1098581,g:44013,r:'Americas'},
  '070':{n:'Bosnia and Herzegovina',c:'Sarajevo',p:3233526,a:51197,g:22168,r:'Europe'},
  '072':{n:'Botswana',c:'Gaborone',p:2630296,a:581730,g:17797,r:'Africa'},
  '076':{n:'Brazil',c:'Brasília',p:216422446,a:8515767,g:1920096,r:'Americas'},
  '084':{n:'Belize',c:'Belmopan',p:405272,a:22966,g:2818,r:'Americas'},
  '090':{n:'Solomon Islands',c:'Honiara',p:740424,a:28896,g:1567,r:'Oceania'},
  '096':{n:'Brunei',c:'Bandar Seri Begawan',p:449002,a:5765,g:14014,r:'Asia'},
  '100':{n:'Bulgaria',c:'Sofia',p:6447710,a:110879,g:92136,r:'Europe'},
  '104':{n:'Myanmar',c:'Naypyidaw',p:54179306,a:676578,g:59362,r:'Asia'},
  '108':{n:'Burundi',c:'Gitega',p:12889576,a:27834,g:3079,r:'Africa'},
  '112':{n:'Belarus',c:'Minsk',p:9498238,a:207600,g:73100,r:'Europe'},
  '116':{n:'Cambodia',c:'Phnom Penh',p:16767842,a:181035,g:29602,r:'Asia'},
  '120':{n:'Cameroon',c:'Yaoundé',p:27914536,a:475442,g:44733,r:'Africa'},
  '124':{n:'Canada',c:'Ottawa',p:38929902,a:9984670,g:2139840,r:'Americas'},
  '132':{n:'Cape Verde',c:'Praia',p:593149,a:4033,g:2187,r:'Africa'},
  '140':{n:'Central African Republic',c:'Bangui',p:5579144,a:622984,g:2408,r:'Africa'},
  '144':{n:'Sri Lanka',c:'Colombo',p:22037000,a:65610,g:74409,r:'Asia'},
  '148':{n:'Chad',c:"N'Djamena",p:17723315,a:1284000,g:11306,r:'Africa'},
  '152':{n:'Chile',c:'Santiago',p:19493184,a:756102,g:300742,r:'Americas'},
  '156':{n:'China',c:'Beijing',p:1425671352,a:9596961,g:17963171,r:'Asia'},
  '158':{n:'Taiwan',c:'Taipei',p:23894394,a:36193,g:790701,r:'Asia'},
  '170':{n:'Colombia',c:'Bogotá',p:52085168,a:1141748,g:343618,r:'Americas'},
  '174':{n:'Comoros',c:'Moroni',p:836774,a:1862,g:1262,r:'Africa'},
  '178':{n:'Republic of the Congo',c:'Brazzaville',p:5970424,a:342000,g:13233,r:'Africa'},
  '180':{n:'Dem. Rep. Congo',c:'Kinshasa',p:102262808,a:2344858,g:55854,r:'Africa'},
  '188':{n:'Costa Rica',c:'San José',p:5212173,a:51100,g:68380,r:'Americas'},
  '191':{n:'Croatia',c:'Zagreb',p:3855600,a:56594,g:71369,r:'Europe'},
  '192':{n:'Cuba',c:'Havana',p:11194449,a:109884,g:107350,r:'Americas'},
  '196':{n:'Cyprus',c:'Nicosia',p:1251488,a:9251,g:27844,r:'Europe'},
  '203':{n:'Czechia',c:'Prague',p:10827529,a:78867,g:290922,r:'Europe'},
  '204':{n:'Benin',c:'Porto-Novo',p:13352864,a:112622,g:17410,r:'Africa'},
  '208':{n:'Denmark',c:'Copenhagen',p:5910913,a:43094,g:395404,r:'Europe'},
  '212':{n:'Dominica',c:'Roseau',p:72654,a:751,g:565,r:'Americas'},
  '214':{n:'Dominican Republic',c:'Santo Domingo',p:11228821,a:48671,g:113579,r:'Americas'},
  '218':{n:'Ecuador',c:'Quito',p:18001000,a:283561,g:115046,r:'Americas'},
  '222':{n:'El Salvador',c:'San Salvador',p:6364943,a:21041,g:32510,r:'Americas'},
  '226':{n:'Equatorial Guinea',c:'Malabo',p:1714671,a:28051,g:12366,r:'Africa'},
  '231':{n:'Ethiopia',c:'Addis Ababa',p:126527060,a:1104300,g:126777,r:'Africa'},
  '232':{n:'Eritrea',c:'Asmara',p:3748901,a:117600,g:2097,r:'Africa'},
  '233':{n:'Estonia',c:'Tallinn',p:1322765,a:45228,g:38107,r:'Europe'},
  '234':{n:'Faroe Islands',c:'Tórshavn',p:53320,a:1393,g:4694,r:'Europe'},
  '242':{n:'Fiji',c:'Suva',p:936375,a:18274,g:5181,r:'Oceania'},
  '246':{n:'Finland',c:'Helsinki',p:5545475,a:338424,g:282640,r:'Europe'},
  '250':{n:'France',c:'Paris',p:64756584,a:643801,g:2782905,r:'Europe'},
  '258':{n:'French Polynesia',c:'Papeete',p:308872,a:4167,g:5650,r:'Oceania'},
  '262':{n:'Djibouti',c:'Djibouti',p:1136455,a:23200,g:3565,r:'Africa'},
  '266':{n:'Gabon',c:'Libreville',p:2388992,a:267668,g:20253,r:'Africa'},
  '268':{n:'Georgia',c:'Tbilisi',p:3728573,a:69700,g:24610,r:'Asia'},
  '270':{n:'Gambia',c:'Banjul',p:2639916,a:10689,g:2104,r:'Africa'},
  '275':{n:'Palestine',c:'Ramallah',p:5483450,a:6020,g:17373,r:'Asia'},
  '276':{n:'Germany',c:'Berlin',p:83294633,a:357114,g:4072192,r:'Europe'},
  '288':{n:'Ghana',c:'Accra',p:33475870,a:238533,g:72637,r:'Africa'},
  '296':{n:'Kiribati',c:'South Tarawa',p:128874,a:811,g:222,r:'Oceania'},
  '300':{n:'Greece',c:'Athens',p:10341277,a:131957,g:219075,r:'Europe'},
  '304':{n:'Greenland',c:'Nuuk',p:56653,a:2166086,g:3082,r:'Americas'},
  '308':{n:'Grenada',c:"St. George's",p:125438,a:344,g:1187,r:'Americas'},
  '320':{n:'Guatemala',c:'Guatemala City',p:17608483,a:108889,g:95003,r:'Americas'},
  '324':{n:'Guinea',c:'Conakry',p:13859341,a:245857,g:16134,r:'Africa'},
  '328':{n:'Guyana',c:'Georgetown',p:808726,a:214969,g:14473,r:'Americas'},
  '332':{n:'Haiti',c:'Port-au-Prince',p:11724763,a:27750,g:20944,r:'Americas'},
  '340':{n:'Honduras',c:'Tegucigalpa',p:10432860,a:112492,g:31723,r:'Americas'},
  '344':{n:'Hong Kong',c:'Hong Kong',p:7488165,a:1106,g:359835,r:'Asia'},
  '348':{n:'Hungary',c:'Budapest',p:9597085,a:93028,g:188493,r:'Europe'},
  '352':{n:'Iceland',c:'Reykjavik',p:393396,a:103000,g:27910,r:'Europe'},
  '356':{n:'India',c:'New Delhi',p:1428627663,a:3287263,g:3385090,r:'Asia'},
  '360':{n:'Indonesia',c:'Jakarta',p:277534122,a:1904569,g:1319100,r:'Asia'},
  '364':{n:'Iran',c:'Tehran',p:88550570,a:1648195,g:388544,r:'Asia'},
  '368':{n:'Iraq',c:'Baghdad',p:44496122,a:438317,g:264175,r:'Asia'},
  '372':{n:'Ireland',c:'Dublin',p:5056935,a:70273,g:529175,r:'Europe'},
  '376':{n:'Israel',c:'Jerusalem',p:9038309,a:20770,g:525004,r:'Asia'},
  '380':{n:'Italy',c:'Rome',p:58870762,a:301340,g:2010431,r:'Europe'},
  '384':{n:"Côte d'Ivoire",c:'Yamoussoukro',p:28160542,a:322463,g:70042,r:'Africa'},
  '388':{n:'Jamaica',c:'Kingston',p:2825544,a:10991,g:17105,r:'Americas'},
  '392':{n:'Japan',c:'Tokyo',p:123294513,a:377975,g:4231141,r:'Asia'},
  '398':{n:'Kazakhstan',c:'Astana',p:19606633,a:2724900,g:220622,r:'Asia'},
  '400':{n:'Jordan',c:'Amman',p:11337052,a:89342,g:47503,r:'Asia'},
  '404':{n:'Kenya',c:'Nairobi',p:55100586,a:580367,g:113420,r:'Africa'},
  '408':{n:'North Korea',c:'Pyongyang',p:26160821,a:120538,g:18001,r:'Asia'},
  '410':{n:'South Korea',c:'Seoul',p:51784059,a:100210,g:1665246,r:'Asia'},
  '414':{n:'Kuwait',c:'Kuwait City',p:4310108,a:17818,g:184617,r:'Asia'},
  '417':{n:'Kyrgyzstan',c:'Bishkek',p:6974000,a:199951,g:10920,r:'Asia'},
  '418':{n:'Laos',c:'Vientiane',p:7529475,a:236800,g:14304,r:'Asia'},
  '422':{n:'Lebanon',c:'Beirut',p:5489739,a:10452,g:18098,r:'Asia'},
  '426':{n:'Lesotho',c:'Maseru',p:2330318,a:30355,g:2548,r:'Africa'},
  '428':{n:'Latvia',c:'Riga',p:1830211,a:64559,g:41135,r:'Europe'},
  '430':{n:'Liberia',c:'Monrovia',p:5358483,a:111369,g:4050,r:'Africa'},
  '434':{n:'Libya',c:'Tripoli',p:6888388,a:1759540,g:42572,r:'Africa'},
  '438':{n:'Liechtenstein',c:'Vaduz',p:39585,a:160,g:7166,r:'Europe'},
  '440':{n:'Lithuania',c:'Vilnius',p:2718352,a:65300,g:67238,r:'Europe'},
  '442':{n:'Luxembourg',c:'Luxembourg',p:660809,a:2586,g:82215,r:'Europe'},
  '450':{n:'Madagascar',c:'Antananarivo',p:29611714,a:587041,g:14490,r:'Africa'},
  '454':{n:'Malawi',c:'Lilongwe',p:20405317,a:118484,g:12440,r:'Africa'},
  '458':{n:'Malaysia',c:'Kuala Lumpur',p:33938221,a:330803,g:407026,r:'Asia'},
  '462':{n:'Maldives',c:'Malé',p:521021,a:300,g:6177,r:'Asia'},
  '466':{n:'Mali',c:'Bamako',p:22593590,a:1240192,g:19140,r:'Africa'},
  '470':{n:'Malta',c:'Valletta',p:535608,a:316,g:17742,r:'Europe'},
  '478':{n:'Mauritania',c:'Nouakchott',p:4862989,a:1030700,g:9902,r:'Africa'},
  '480':{n:'Mauritius',c:'Port Louis',p:1265795,a:2040,g:14343,r:'Africa'},
  '484':{n:'Mexico',c:'Mexico City',p:128901000,a:1964375,g:1322681,r:'Americas'},
  '492':{n:'Monaco',c:'Monaco',p:36689,a:2,g:8634,r:'Europe'},
  '496':{n:'Mongolia',c:'Ulaanbaatar',p:3447157,a:1564110,g:17146,r:'Asia'},
  '498':{n:'Moldova',c:'Chișinău',p:2600498,a:33846,g:14479,r:'Europe'},
  '499':{n:'Montenegro',c:'Podgorica',p:616695,a:13812,g:6103,r:'Europe'},
  '504':{n:'Morocco',c:'Rabat',p:37840044,a:446550,g:134180,r:'Africa'},
  '508':{n:'Mozambique',c:'Maputo',p:33694579,a:801590,g:16659,r:'Africa'},
  '512':{n:'Oman',c:'Muscat',p:4644384,a:309500,g:104943,r:'Asia'},
  '516':{n:'Namibia',c:'Windhoek',p:2604172,a:825615,g:12594,r:'Africa'},
  '520':{n:'Nauru',c:'Yaren',p:12668,a:21,g:133,r:'Oceania'},
  '524':{n:'Nepal',c:'Kathmandu',p:30896590,a:147181,g:40828,r:'Asia'},
  '528':{n:'Netherlands',c:'Amsterdam',p:17618299,a:41543,g:1009021,r:'Europe'},
  '540':{n:'New Caledonia',c:'Nouméa',p:288439,a:18575,g:9961,r:'Oceania'},
  '548':{n:'Vanuatu',c:'Port Vila',p:326740,a:12189,g:964,r:'Oceania'},
  '554':{n:'New Zealand',c:'Wellington',p:5228100,a:270467,g:247235,r:'Oceania'},
  '558':{n:'Nicaragua',c:'Managua',p:7046310,a:130373,g:15679,r:'Americas'},
  '562':{n:'Niger',c:'Niamey',p:26207977,a:1267000,g:14790,r:'Africa'},
  '566':{n:'Nigeria',c:'Abuja',p:223804632,a:923768,g:477386,r:'Africa'},
  '570':{n:'Niue',c:'Alofi',p:1935,a:260,g:28,r:'Oceania'},
  '578':{n:'Norway',c:'Oslo',p:5474360,a:323802,g:579267,r:'Europe'},
  '580':{n:'Northern Mariana Islands',c:'Saipan',p:47329,a:464,g:1236,r:'Oceania'},
  '583':{n:'Micronesia',c:'Palikir',p:114161,a:702,g:404,r:'Oceania'},
  '584':{n:'Marshall Islands',c:'Majuro',p:41996,a:181,g:284,r:'Oceania'},
  '585':{n:'Palau',c:'Ngerulmud',p:18055,a:459,g:295,r:'Oceania'},
  '586':{n:'Pakistan',c:'Islamabad',p:240485658,a:881913,g:348263,r:'Asia'},
  '591':{n:'Panama',c:'Panama City',p:4408581,a:75417,g:76520,r:'Americas'},
  '598':{n:'Papua New Guinea',c:'Port Moresby',p:10329931,a:462840,g:30366,r:'Oceania'},
  '600':{n:'Paraguay',c:'Asunción',p:6861524,a:406752,g:43017,r:'Americas'},
  '604':{n:'Peru',c:'Lima',p:34352719,a:1285216,g:242624,r:'Americas'},
  '608':{n:'Philippines',c:'Manila',p:117337368,a:300000,g:404284,r:'Asia'},
  '616':{n:'Poland',c:'Warsaw',p:36753736,a:312696,g:688177,r:'Europe'},
  '620':{n:'Portugal',c:'Lisbon',p:10467366,a:92090,g:251925,r:'Europe'},
  '624':{n:'Guinea-Bissau',c:'Bissau',p:2119011,a:36125,g:1620,r:'Africa'},
  '626':{n:'Timor-Leste',c:'Dili',p:1362000,a:14919,g:2016,r:'Asia'},
  '630':{n:'Puerto Rico',c:'San Juan',p:3260561,a:8870,g:113425,r:'Americas'},
  '634':{n:'Qatar',c:'Doha',p:2688235,a:11586,g:221369,r:'Asia'},
  '642':{n:'Romania',c:'Bucharest',p:19892812,a:238391,g:301258,r:'Europe'},
  '643':{n:'Russia',c:'Moscow',p:144236933,a:17098242,g:2240422,r:'Europe'},
  '646':{n:'Rwanda',c:'Kigali',p:13776698,a:26338,g:13370,r:'Africa'},
  '682':{n:'Saudi Arabia',c:'Riyadh',p:36947025,a:2149690,g:1108149,r:'Asia'},
  '686':{n:'Senegal',c:'Dakar',p:17763163,a:196722,g:27627,r:'Africa'},
  '688':{n:'Serbia',c:'Belgrade',p:7149077,a:88361,g:63167,r:'Europe'},
  '694':{n:'Sierra Leone',c:'Freetown',p:8791092,a:71740,g:4253,r:'Africa'},
  '702':{n:'Singapore',c:'Singapore',p:5917648,a:728,g:397011,r:'Asia'},
  '703':{n:'Slovakia',c:'Bratislava',p:5643453,a:49035,g:115526,r:'Europe'},
  '704':{n:'Vietnam',c:'Hanoi',p:98858950,a:331212,g:408808,r:'Asia'},
  '705':{n:'Slovenia',c:'Ljubljana',p:2119675,a:20273,g:63174,r:'Europe'},
  '706':{n:'Somalia',c:'Mogadishu',p:18143378,a:637657,g:8106,r:'Africa'},
  '710':{n:'South Africa',c:'Pretoria',p:60414495,a:1221037,g:399016,r:'Africa'},
  '716':{n:'Zimbabwe',c:'Harare',p:16665409,a:390757,g:28517,r:'Africa'},
  '724':{n:'Spain',c:'Madrid',p:47519628,a:505992,g:1397870,r:'Europe'},
  '728':{n:'South Sudan',c:'Juba',p:11088796,a:644329,g:11888,r:'Africa'},
  '729':{n:'Sudan',c:'Khartoum',p:48109006,a:1886068,g:26115,r:'Africa'},
  '732':{n:'Western Sahara',c:'Laayoune',p:612000,a:266000,g:0,r:'Africa'},
  '740':{n:'Suriname',c:'Paramaribo',p:618040,a:163820,g:3489,r:'Americas'},
  '748':{n:'Eswatini',c:'Mbabane',p:1210822,a:17364,g:4894,r:'Africa'},
  '752':{n:'Sweden',c:'Stockholm',p:10612086,a:450295,g:585939,r:'Europe'},
  '756':{n:'Switzerland',c:'Bern',p:8796669,a:41284,g:807706,r:'Europe'},
  '760':{n:'Syria',c:'Damascus',p:22933531,a:185180,g:11362,r:'Asia'},
  '762':{n:'Tajikistan',c:'Dushanbe',p:10143543,a:143100,g:10499,r:'Asia'},
  '764':{n:'Thailand',c:'Bangkok',p:71801279,a:513120,g:495348,r:'Asia'},
  '768':{n:'Togo',c:'Lomé',p:8848699,a:56785,g:8141,r:'Africa'},
  '776':{n:'Tonga',c:"Nuku'alofa",p:107773,a:747,g:467,r:'Oceania'},
  '780':{n:'Trinidad and Tobago',c:'Port of Spain',p:1534937,a:5130,g:28074,r:'Americas'},
  '784':{n:'United Arab Emirates',c:'Abu Dhabi',p:9441129,a:83600,g:507534,r:'Asia'},
  '788':{n:'Tunisia',c:'Tunis',p:12458223,a:163610,g:46277,r:'Africa'},
  '792':{n:'Turkey',c:'Ankara',p:85279553,a:783562,g:905988,r:'Asia'},
  '795':{n:'Turkmenistan',c:'Ashgabat',p:6516100,a:488100,g:45232,r:'Asia'},
  '800':{n:'Uganda',c:'Kampala',p:48582334,a:241550,g:45561,r:'Africa'},
  '804':{n:'Ukraine',c:'Kyiv',p:37000000,a:603550,g:160502,r:'Europe'},
  '807':{n:'North Macedonia',c:'Skopje',p:1836713,a:25713,g:13602,r:'Europe'},
  '818':{n:'Egypt',c:'Cairo',p:112716598,a:1002450,g:404143,r:'Africa'},
  '826':{n:'United Kingdom',c:'London',p:67736802,a:242495,g:3070668,r:'Europe'},
  '834':{n:'Tanzania',c:'Dodoma',p:65497748,a:945087,g:75708,r:'Africa'},
  '840':{n:'United States of America',c:'Washington, D.C.',p:339996563,a:9833520,g:25462700,r:'Americas'},
  '854':{n:'Burkina Faso',c:'Ouagadougou',p:22673762,a:274222,g:19740,r:'Africa'},
  '858':{n:'Uruguay',c:'Montevideo',p:3423108,a:176215,g:71159,r:'Americas'},
  '860':{n:'Uzbekistan',c:'Tashkent',p:35648100,a:448978,g:80391,r:'Asia'},
  '862':{n:'Venezuela',c:'Caracas',p:28838499,a:916445,g:98276,r:'Americas'},
  '876':{n:'Wallis and Futuna',c:'Mata-Utu',p:11239,a:142,g:0,r:'Oceania'},
  '882':{n:'Samoa',c:'Apia',p:222382,a:2842,g:843,r:'Oceania'},
  '887':{n:'Yemen',c:"Sana'a",p:34449825,a:527968,g:21364,r:'Asia'},
  '894':{n:'Zambia',c:'Lusaka',p:20017675,a:752618,g:29787,r:'Africa'},
};

async function loadCountryData() {
  updateLoadStatus('Loading country boundaries…');
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const world = await resp.json();

    await loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js');

    const countriesGeo = topojson.feature(world, world.objects.countries);
    processGeoJsonCountries(countriesGeo);
    onAssetLoaded('geojson');
  } catch (e) {
    console.warn('Failed to load country data:', e);
    onAssetLoaded('geojson');
  }
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

// ── Build country borders and spatial grid ─────────────────────────────────
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
      const ring = polygon[0];
      polygons.push(ring.map(c => c));

      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        const p1 = latLonToVec3(lat1, lon1, EARTH_RADIUS + 0.002);
        const p2 = latLonToVec3(lat2, lon2, EARTH_RADIUS + 0.002);
        linePoints.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }

    const featureIdx = geoJsonFeatures.length;
    geoJsonFeatures.push({ id, polygons, name: feature.properties?.name || String(id) });
  }

  // Build border lines
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4d9fff, transparent: true, opacity: 0.2, depthTest: true });
  countryLinesMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(countryLinesMesh);

  // Build spatial lookup grid
  buildCountryGrid();
}

function buildCountryGrid() {
  countryGrid = new Int16Array(GRID_LAT_SIZE * GRID_LON_SIZE).fill(-1);

  // First pass: rasterize all polygons, allowing multiple claims per cell
  // We store all claimants per cell, then resolve to the best match
  const claims = new Array(GRID_LAT_SIZE * GRID_LON_SIZE);
  for (let i = 0; i < claims.length; i++) claims[i] = [];

  for (let fi = 0; fi < geoJsonFeatures.length; fi++) {
    const feature = geoJsonFeatures[fi];
    for (const polygon of feature.polygons) {
      rasterizePolygon(polygon, fi, claims);
    }
  }

  // Resolve: for each cell with multiple claims, pick the country whose
  // polygon centroid is closest to the cell center
  for (let i = 0; i < claims.length; i++) {
    if (claims[i].length === 0) continue;
    if (claims[i].length === 1) {
      countryGrid[i] = claims[i][0];
      continue;
    }
    // Multiple claims: pick the feature with smallest polygon area
    let bestFi = claims[i][0];
    let bestArea = Infinity;
    const li = Math.floor(i / GRID_LON_SIZE);
    const lo = i % GRID_LON_SIZE;
    const cellLat = li - 90 + 0.5;
    const cellLon = lo - 180 + 0.5;
    for (const fi of claims[i]) {
      const d = distToCentroid(geoJsonFeatures[fi], cellLat, cellLon);
      if (d < bestArea) { bestArea = d; bestFi = fi; }
    }
    countryGrid[i] = bestFi;
  }
}

function distToCentroid(feature, lat, lon) {
  // Compute centroid of all polygons, then angular distance to (lat, lon)
  let cx = 0, cy = 0, cz = 0, count = 0;
  for (const ring of feature.polygons) {
    for (const [lo, la] of ring) {
      const phi = la * Math.PI / 180;
      const theta = lo * Math.PI / 180;
      cx += Math.cos(phi) * Math.cos(theta);
      cy += Math.cos(phi) * Math.sin(theta);
      cz += Math.sin(phi);
      count++;
    }
  }
  cx /= count; cy /= count; cz /= count;
  const phi = lat * Math.PI / 180;
  const theta = lon * Math.PI / 180;
  const px = Math.cos(phi) * Math.cos(theta);
  const py = Math.cos(phi) * Math.sin(theta);
  const pz = Math.sin(phi);
  // Angular distance (lower = closer)
  return 1 - (cx * px + cy * py + cz * pz);
}

function rasterizePolygon(ring, featureIdx, claims) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  const crossesAntimeridian = (maxLon - minLon) > 180;

  const latStart = Math.max(0, Math.floor(minLat + 90));
  const latEnd = Math.min(GRID_LAT_SIZE - 1, Math.ceil(maxLat + 90));
  let lonStart, lonEnd;

  if (crossesAntimeridian) {
    lonStart = 0;
    lonEnd = GRID_LON_SIZE - 1;
  } else {
    lonStart = Math.max(0, Math.floor(minLon + 180));
    lonEnd = Math.min(GRID_LON_SIZE - 1, Math.ceil(maxLon + 180));
  }

  for (let li = latStart; li <= latEnd; li++) {
    for (let lo = lonStart; lo <= lonEnd; lo++) {
      const lat = li - 90 + 0.5;
      const lon = lo - 180 + 0.5;
      const idx = li * GRID_LON_SIZE + lo;
      if (pointInPolygonSpherical(lat, lon, ring)) {
        if (!claims[idx].includes(featureIdx)) {
          claims[idx].push(featureIdx);
        }
      }
    }
  }
}

// ── Spherical point-in-polygon ─────────────────────────────────────────────
// Uses 3D ray casting on the unit sphere. Converts all points to Cartesian,
// then counts how many times a great-circle arc from the test point to a
// fixed reference direction crosses the polygon boundary.
function pointInPolygonSpherical(lat, lon, ring) {
  const n = ring.length;
  if (n < 3) return false;

  // Convert test point to unit vector
  const pLat = lat * Math.PI / 180;
  const pLon = lon * Math.PI / 180;
  const px = Math.cos(pLat) * Math.cos(pLon);
  const py = Math.cos(pLat) * Math.sin(pLon);
  const pz = Math.sin(pLat);

  // Convert polygon vertices to unit vectors
  const verts = [];
  for (let i = 0; i < n; i++) {
    const vLon = ring[i][0] * Math.PI / 180;
    const vLat = ring[i][1] * Math.PI / 180;
    verts.push([
      Math.cos(vLat) * Math.cos(vLon),
      Math.cos(vLat) * Math.sin(vLon),
      Math.sin(vLat)
    ]);
  }

  // Use winding number on the tangent plane at the test point
  // Project all polygon vertices onto the tangent plane at p,
  // then use 2D winding number.
  // Tangent basis vectors at p:
  //   e1 = (-sin(pLon), cos(pLon), 0)  (east)
  //   e2 = (-sin(pLat)*cos(pLon), -sin(pLat)*sin(pLon), cos(pLat))  (north)
  const e1x = -Math.sin(pLon), e1y = Math.cos(pLon), e1z = 0;
  const e2x = -Math.sin(pLat) * Math.cos(pLon);
  const e2y = -Math.sin(pLat) * Math.sin(pLon);
  const e2z = Math.cos(pLat);

  // Project and compute 2D winding number
  let winding = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Vector from p to vertex
    const dxi = verts[i][0] - px, dyi = verts[i][1] - py, dzi = verts[i][2] - pz;
    const dxj = verts[j][0] - px, dyj = verts[j][1] - py, dzj = verts[j][2] - pz;
    // Project onto tangent plane
    const xi = dxi * e1x + dyi * e1y + dzi * e1z;
    const yi = dxi * e2x + dyi * e2y + dzi * e2z;
    const xj = dxj * e1x + dyj * e1y + dzj * e1z;
    const yj = dxj * e2x + dyj * e2y + dzj * e2z;
    // Accumulate angle
    const cross = xi * yj - xj * yi;
    const dot = xi * xj + yi * yj;
    winding += Math.atan2(cross, dot);
  }

  // Winding number ≈ 2π if inside, ≈ 0 if outside
  return Math.abs(winding) > Math.PI;
}

function findCountryAt(lat, lon) {
  if (!countryGrid) return null;

  // Snap to grid cell
  const li = Math.round(lat + 90);
  const lo = Math.round(lon + 180);

  if (li < 0 || li >= GRID_LAT_SIZE || lo < 0 || lo >= GRID_LON_SIZE) return null;

  const fi = countryGrid[li * GRID_LON_SIZE + lo];
  if (fi === -1) return null;
  return geoJsonFeatures[fi];
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

  for (const ring of feature.polygons) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      const p1 = latLonToVec3(lat1, lon1, EARTH_RADIUS + 0.004);
      const p2 = latLonToVec3(lat2, lon2, EARTH_RADIUS + 0.004);
      linePoints.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    // Fill: triangle fan from centroid
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
    for (const v of vecs) fillVerts.push(v.x, v.y, v.z);
    for (let i = 0; i < n; i++) {
      fillIndices.push(baseIdx, baseIdx + 1 + i, baseIdx + 1 + ((i + 1) % n));
    }
  }

  if (linePoints.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    highlightLineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x4d9fff, transparent: true, opacity: 0.9, depthTest: true,
    }));
    scene.add(highlightLineMesh);
  }

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
  // Must invert: theta = (lon + 180)*PI/180, x = -r*sin(phi)*cos(theta), z = r*sin(phi)*sin(theta)
  // atan2(z, -x) = atan2(sin(theta), cos(theta)) = theta
  // lon = theta*180/PI - 180
  const theta = Math.atan2(v.z, -v.x);
  let lon = theta * (180 / Math.PI) - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
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
      positionPopup(e);
    } else {
      hoveredCountryId = null;
      clearHighlight();
      popup.classList.add('hidden');
      renderer.domElement.style.cursor = 'grab';
    }

    if (feature) renderer.domElement.style.cursor = 'pointer';
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
  document.getElementById('popup-flag').innerHTML = '';
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
  const c = COUNTRIES[String(id)];
  if (c) return { name: c.n, capital: c.c, population: c.p, area: c.a, gdp: c.g, region: c.r, flag: '' };
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
