/*-----------------------------Bridges List-----------------------------------------*/
const BRIDGES = {
  bridge_1: {
    name: 'N1 Overpass — Section 4',
    type: 'Simply-supported beam bridge',
    location: 'Pretoria, Gauteng',
    span: 20,   
  },
  bridge_2: {
    name: 'Vaal River Crossing',
    type: 'Multi-girder bridge',
    location: 'Vereeniging, Gauteng',
    span: 35,
  },
  bridge_3: {
    name: 'Hennops Valley Truss Bridge',
    type: 'Steel truss bridge',
    location: 'Centurion, Gauteng',
    span: 48,
  }
};
/*------------------------------------Global Variables-----------------------------------------*/
let activeBridge = null;
let chart = null;

/*------------------------------------Render Bridge Cards----------------------------------------*/
function renderBridgeGrid(){
  const grid= document.getElementById("gridBridge");
  grid.innerHTML = "";
  Object.keys(BRIDGES).forEach(function(id){
    const bridge= BRIDGES[id];
    const card= document.createElement("button");
    card.className= "bridgeCard";
    card.innerHTML= `
      <h2>${bridge.name}</h2>
      <p>${bridge.location}</p>
      <p>${bridge.type}</p>
      <p>Span: ${bridge.span} m</p>
    `;
    card.addEventListener("click", function () {
      openBridge(id);
    });
    grid.appendChild(card);
  })
}

/*------------------------------------OPEN DASHBOARD--------------------------------------------*/
function openBridge(id) {

    activeBridge = id;

    const bridge = BRIDGES[id];

    document.getElementById("bridgeView").style.display = "none";

    document.getElementById("viewDetail").style.display = "block";

    document.getElementById("detailName").textContent = bridge.name;

    document.getElementById("detailMeta").textContent =
        `${bridge.location} | ${bridge.type} | Span ${bridge.span} m`;

    updateDashboard();

}
/*---------------------------------BACK BUTTON---------------------------------- */
document.getElementById("backBridges").addEventListener("click", function(){

    document.getElementById("viewDetail").style.display = "none";

    document.getElementById("bridgeView").style.display = "block";

});
/*---------------------------------UPDATE SENSOR CARDS------------------------------------*/
function updateCards(readings){

    document.getElementById("valDeflection").textContent =
        readings.deflection + " mm";

    document.getElementById("valCrack").textContent =
        readings.crack + " mm";

    document.getElementById("valStrain").textContent =
        readings.strain;

    document.getElementById("valTemp").textContent =
        readings.temp + " °C";

}


/*---------------------------------CREATE & UPDATE CHART---------------------------------------*/

function createChart(){
  const ctx=document.getElementById("trendChart");
  chart=new Chart(ctx,{
    type:"line",
    data:{
      labels:[],
      datasets:[{
        label:"Deflection (mm)",
        data:[],
        borderColor:"#38bdf8",
        borderWidth: 2,
        tension: 0.4 
      }]
      
},
options:{
  responsive:true,
  maintainAspectRatio:false,}
});
}
function updateChart(readings){
  if(chart=== null){
    return;
  }
  chart.data.labels.push("");
  chart.data.datasets[0].data.push(readings.deflection);
  if(chart.data.labels.length > 15){
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update();
}
/*---------------------------------UPDATE DASHBOARD---------------------------------------*/
function updateDashboard(){
  const readings= generateData();
  updateCards(readings);
  updateChart(readings);
}
/*---------------------------------GENERATE RANDOM DATA: IN PLACE FOR PYTHON SIMULATION---------------------------------------*/
function generateData(){

    return {

        deflection: Number((Math.random()*60).toFixed(1)),

        crack: Number((Math.random()*0.40).toFixed(2)),

        strain: Number((Math.random()).toFixed(2)),

        temp: Number((20 + Math.random()*15).toFixed(1))

    };

}
/*---------------------------------AUTO UPDATE, 5SECONDS ---------------------------------------*/
setInterval(function(){

    if(activeBridge !== null){

        updateDashboard();

    }

},5000);
/*---------------------------------INITIALIZE---------------------------------------*/
renderBridgeGrid();
createChart();