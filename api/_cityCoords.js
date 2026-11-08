// City and country coordinates for the public builder globe (/search).
// Approximate centres are fine — markers name the city, not a street address.
// Unknown City, Country pairs fall back to the country centroid so every
// public member still appears. Locations that match neither are omitted.
const CITY_ROWS = [
  ['Harare',-17.825,31.033],['Hararre',-17.825,31.033],['Bulawayo',-20.15,28.58],['Gweru',-19.45,29.82],['Mutare',-18.97,32.65],['Masvingo',-20.07,30.83],
  ['Lusaka',-15.387,28.322],['Ndola',-12.967,28.633],['Kitwe',-12.802,28.214],['Lilongwe',-13.983,33.767],['Blantyre',-15.786,35.005],
  ['Maputo',-25.969,32.573],['Gaborone',-24.633,25.9],['Windhoek',-22.56,17.083],
  ['Nairobi',-1.286,36.817],['Mombasa',-4.032,39.668],['Kisumu',-0.091,34.768],['Kampala',0.347,32.582],['Dar es Salaam',-6.792,39.208],
  ['Addis Ababa',9.032,38.747],['Kigali',-1.941,30.061],['Antananarivo',-18.879,47.508],
  ['Lagos',6.524,3.379],['Abuja',9.057,7.495],['Port Harcourt',4.815,7.049],['Ibadan',7.377,3.947],['Accra',5.604,-0.187],['Kumasi',6.688,-1.624],
  ['Dakar',14.693,-17.445],['Abidjan',5.36,-4.008],['Douala',4.051,9.767],['Buea',4.153,9.241],['Yaounde',3.848,11.502],['Kinshasa',-4.324,15.314],
  ['Luanda',-8.839,13.289],['Casablanca',33.573,-7.59],['Rabat',34.021,-6.841],['Marrakech',31.63,-7.981],['Fes',34.034,-5.0],['Algiers',36.737,3.087],['Tunis',36.806,10.181],['Tripoli',32.887,13.191],
  ['Cairo',30.044,31.236],['6th of October',29.972,30.943],['Alexandria',31.2,29.918],['Khartoum',15.501,32.559],['Juba',4.859,31.578],
  ['Johannesburg',-26.205,28.047],['Cape Town',-33.925,18.424],['Capetown',-33.925,18.424],['Polokwane',-23.905,29.469],['Pretoria',-25.748,28.229],['Durban',-29.859,31.029],['Sandton',-26.107,28.057],['Port Elizabeth',-33.96,25.602],
  ['New York',40.713,-74.006],['San Francisco',37.775,-122.419],['San Jose',37.339,-121.895],['Palo Alto',37.442,-122.143],['Los Angeles',34.052,-118.244],
  ['Seattle',47.606,-122.332],['Austin',30.267,-97.743],['Boston',42.36,-71.06],['Chicago',41.878,-87.63],['Atlanta',33.749,-84.388],['Suwanee',34.051,-84.071],
  ['Miami',25.762,-80.192],['Merritt Island',28.359,-80.685],['Dallas',32.777,-96.797],['Houston',29.76,-95.37],['Denver',39.739,-105.0],['Phoenix',33.448,-112.074],
  ['Philadelphia',39.953,-75.165],['Washington',38.907,-77.037],['Washington DC',38.907,-77.037],
  ['Toronto',43.653,-79.383],['Vancouver',49.283,-123.121],['Montreal',45.502,-73.567],['Ottawa',45.421,-75.697],
  ['Mexico City',19.433,-99.133],['Guadalajara',20.659,-103.349],['Monterrey',25.686,-100.316],
  ['Sao Paulo',-23.55,-46.633],['São Paulo',-23.55,-46.633],['Rio de Janeiro',-22.907,-43.173],['Buenos Aires',-34.603,-58.381],
  ['Santiago',-33.448,-70.669],['Lima',-12.046,-77.043],['Bogota',4.711,-74.072],['Bogotá',4.711,-74.072],['Caracas',10.481,-66.903],['Montevideo',-34.901,-56.164],['Quito',-0.18,-78.467],['Mendoza',-32.889,-68.845],
  ['London',51.507,-0.128],['Manchester',53.48,-2.242],['Birmingham',52.486,-1.89],['Glasgow',55.864,-4.251],['Edinburgh',55.953,-3.189],['Cardiff',51.481,-3.179],
  ['Dublin',53.35,-6.26],['Wexford',52.337,-6.463],['Paris',48.857,2.352],['Lyon',45.764,4.835],['Marseille',43.296,5.37],['Berlin',52.52,13.405],['Munich',48.137,11.575],
  ['Hamburg',53.551,9.993],['Frankfurt',50.11,8.682],['Stuttgart',48.776,9.183],['Amsterdam',52.368,4.904],['Rotterdam',51.924,4.478],
  ['Brussels',50.851,4.352],['Luxembourg',49.611,6.131],['Zurich',47.376,8.541],['Geneva',46.204,6.143],['Vienna',48.208,16.373],
  ['Prague',50.075,14.438],['Warsaw',52.23,21.012],['Krakow',50.065,19.945],['Budapest',47.498,19.04],['Bucharest',44.432,26.103],['Sofia',42.698,23.322],
  ['Athens',37.984,23.728],['Rome',41.903,12.496],['Milan',45.464,9.19],['Naples',40.852,14.268],['Palma Di Montechiaro',37.193,13.765],['Madrid',40.417,-3.703],['Barcelona',41.387,2.17],
  ['Lisbon',38.707,-9.136],['Porto',41.15,-8.629],['Stockholm',59.33,18.069],['Gothenburg',57.708,11.974],['Oslo',59.913,10.752],['Copenhagen',55.676,12.568],
  ['Helsinki',60.17,24.938],['Reykjavik',64.147,-21.943],['Tallinn',59.437,24.754],['Riga',56.95,24.109],['Vilnius',54.687,25.28],
  ['Belgrade',44.817,20.463],['Zagreb',45.815,15.982],['Ljubljana',46.056,14.505],['Istanbul',41.008,28.978],['Ankara',39.933,32.86],
  ['Moscow',55.756,37.617],['Saint Petersburg',59.931,30.36],['Kyiv',50.45,30.524],['Odesa',46.482,30.723],['Almaty',43.238,76.889],
  ['Tel Aviv',32.085,34.782],['Jerusalem',31.768,35.214],['Dubai',25.205,55.271],['Abu Dhabi',24.453,54.377],['Sharjah',25.346,55.421],['Doha',25.286,51.532],
  ['Riyadh',24.713,46.675],['Jeddah',21.485,39.192],['Kuwait City',29.376,47.978],['Manama',26.066,50.557],['Muscat',23.588,58.383],['Amman',31.955,35.945],['Beirut',33.894,35.502],['Baghdad',33.315,44.366],['Tehran',35.689,51.389],
  ['Mumbai',19.076,72.877],['Maharashtra',19.751,75.714],['New Delhi',28.614,77.209],['Delhi',28.614,77.209],['Gurgaon',28.459,77.027],['Noida',28.536,77.391],['Lucknow',26.847,80.946],['Sikar',27.609,75.139],['Hazaribagh',23.992,85.364],['Andhra Pradesh',15.913,79.74],['Bengaluru',12.972,77.595],['Bangalore',12.972,77.595],['Banglore',12.972,77.595],['Hyderabad',17.385,78.487],
  ['Chennai',13.083,80.27],['Kolkata',22.573,88.364],['Pune',18.52,73.857],['Ahmedabad',23.023,72.572],['Jaipur',26.912,75.787],['Surat',21.17,72.831],
  ['Karachi',24.861,67.01],['Lahore',31.52,74.358],['Islamabad',33.684,73.047],['Dhaka',23.811,90.413],['Colombo',6.927,79.862],['Kathmandu',27.717,85.324],
  ['Bangkok',13.756,100.502],['Singapore',1.352,103.82],['Kuala Lumpur',3.139,101.687],['Jakarta',-6.208,106.845],['Surabaya',-7.25,112.752],
  ['Manila',14.6,120.984],['Olongapo City',14.829,120.283],['Quezon City',14.676,121.044],['Cebu',10.316,123.885],['Ho Chi Minh City',10.823,106.63],['Saigon',10.823,106.63],['Hanoi',21.028,105.854],
  ['Hong Kong',22.32,114.17],['Shanghai',31.23,121.474],['Beijing',39.905,116.391],['Shenzhen',22.543,114.058],['Guangzhou',23.13,113.264],['Hangzhou',30.274,120.155],['Nanjing',32.061,118.797],['Chengdu',30.572,104.066],['Wuhan',30.593,114.305],['Xian',34.341,108.94],
  ['Seoul',37.566,126.978],['Busan',35.179,129.076],['Tokyo',35.676,139.65],['Osaka',34.693,135.502],['Kyoto',35.011,135.768],['Fukuoka',33.59,130.401],['Taipei',25.033,121.565],
  ['Sydney',-33.869,151.209],['Melbourne',-37.814,144.963],['Brisbane',-27.47,153.025],['Perth',-31.951,115.861],['Adelaide',-34.929,138.601],['Auckland',-36.848,174.763],['Wellington',-41.286,174.776],['Christchurch',-43.532,172.637],['Suva',-18.141,178.441],
];
const COUNTRY_ROWS = [
  ['Zimbabwe',-19.015,29.154],['Zim',-19.015,29.154],['Zimabbwe',-19.015,29.154],['Zambia',-13.133,27.849],['Malawi',-13.254,34.302],['Mozambique',-18.665,35.529],['Botswana',-22.328,24.684],
  ['Namibia',-22.958,18.49],['South Africa',-30.559,22.938],['Southafrica',-30.559,22.938],['Lesotho',-29.61,28.233],['Eswatini',-26.523,31.465],['Angola',-11.202,17.874],
  ['Kenya',-0.023,37.906],['Uganda',1.373,32.29],['Tanzania',-6.369,34.889],['Ethiopia',9.145,40.489],['Rwanda',-1.94,29.874],['Burundi',-3.373,29.919],
  ['Sudan',12.862,30.217],['South Sudan',6.877,31.307],['Eritrea',15.179,39.782],['Somalia',5.153,46.2],['Madagascar',-18.767,46.869],
  ['Nigeria',9.082,8.675],['Ghana',7.946,-1.023],['Senegal',14.497,-14.452],['Sénégal',14.497,-14.452],['Ivory Coast',7.54,-5.547],["Cote d'Ivoire",7.54,-5.547],['Cameroon',7.369,12.354],['DRC',-4.038,21.759],['Congo',-0.228,15.828],
  ['Morocco',31.792,-7.093],['Algeria',28.034,1.66],['Tunisia',33.887,9.537],['Libya',26.335,17.229],['Egypt',26.821,30.802],
  ['United States',37.09,-95.713],['USA',37.09,-95.713],['America',37.09,-95.713],['United States of America',37.09,-95.713],['Canada',56.13,-106.347],['Mexico',23.635,-102.553],
  ['United Kingdom',55.378,-3.436],['UK',55.378,-3.436],['England',52.892,-1.474],['Scotland',56.49,-4.203],['Ireland',53.412,-8.244],
  ['France',46.228,2.214],['Germany',51.166,10.452],['Netherlands',52.133,5.291],['Belgium',50.504,4.47],['Switzerland',46.818,8.228],['Austria',47.516,14.55],
  ['Spain',40.463,-3.749],['Portugal',39.399,-8.224],['Italy',41.872,12.567],['Italia',41.872,12.567],['Greece',39.074,21.824],['Poland',51.919,19.145],['Czechia',49.817,15.473],
  ['Sweden',60.128,18.644],['Norway',60.472,8.469],['Denmark',56.264,9.502],['Finland',61.924,25.748],['Estonia',58.595,25.014],['Latvia',56.88,24.603],['Lithuania',55.169,23.881],
  ['Ukraine',48.38,31.166],['Russia',61.524,105.319],['Kazakhstan',48.019,66.924],['Turkey',38.964,35.243],['Romania',45.943,24.967],['Bulgaria',42.733,25.485],['Serbia',44.017,21.006],['Hungary',47.162,19.503],
  ['Israel',31.047,34.852],['Iran',32.428,53.688],['Iraq',33.223,43.679],['Saudi Arabia',23.886,45.079],['UAE',23.424,53.848],['United Arab Emirates',23.424,53.848],['Qatar',25.355,51.185],['Kuwait',29.312,47.481],['Jordan',30.585,36.238],['Lebanon',33.855,35.862],
  ['India',20.594,78.963],['Indian',20.594,78.963],['IND',20.594,78.963],['Pakistan',30.375,69.345],['Bangladesh',23.685,90.356],['Sri Lanka',7.874,80.771],['Nepal',28.394,84.124],
  ['Thailand',15.87,100.993],['Singapore',1.352,103.82],['Malaysia',4.21,101.975],['Indonesia',-0.789,113.921],['Philippines',12.88,121.774],['Vietnam',14.058,108.277],['Cambodia',12.565,104.991],
  ['China',35.861,104.195],['Hong Kong',22.319,114.17],['Japan',36.205,138.252],['South Korea',35.908,127.767],['Korea',35.908,127.767],['Taiwan',23.698,120.96],
  ['Australia',-25.274,133.775],['New Zealand',-40.901,174.886],['Fiji',-16.578,179.414],
  ['Brazil',-14.235,-51.925],['Argentina',-38.416,-63.616],['Chile',-35.675,-71.543],['Peru',-9.19,-75.015],['Colombia',4.571,-74.297],['Venezuela',6.424,-66.59],['Uruguay',-32.523,-55.766],['Ecuador',-1.831,-78.183],
];
const norm = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const CITIES = Object.create(null); for (const [name, lat, lng] of CITY_ROWS) CITIES[norm(name)] = [lat, lng, name];
const COUNTRIES = Object.create(null); for (const [name, lat, lng] of COUNTRY_ROWS) COUNTRIES[norm(name)] = [lat, lng, name];
const title = s => String(s).replace(/(^|[\s-])\S/g, m => m.toUpperCase());
export function resolveLocation(city, country) {
  const c = norm(city), y = norm(country);
  if (c && CITIES[c]) return { lat: CITIES[c][0], lng: CITIES[c][1], precision: 'city', label: CITIES[c][2] };
  if (c) for (const key of Object.keys(CITIES)) if (c.length > 2 && (c.startsWith(key) || key.startsWith(c))) return { lat: CITIES[key][0], lng: CITIES[key][1], precision: 'city', label: CITIES[key][2] };
  if (y && COUNTRIES[y]) return { lat: COUNTRIES[y][0], lng: COUNTRIES[y][1], precision: 'country', label: COUNTRIES[y][2] };
  if (y) for (const key of Object.keys(COUNTRIES)) if (y.length > 2 && y.includes(key)) return { lat: COUNTRIES[key][0], lng: COUNTRIES[key][1], precision: 'country', label: COUNTRIES[key][2] };
  return null;
}
