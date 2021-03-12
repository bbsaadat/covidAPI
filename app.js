//jshint esversion:9

const express = require("express");
const puppeteer = require("puppeteer");
const mongoose = require('mongoose');
const NodeCache = require("node-cache");


const PORT = process.env.PORT || 3000;

const app = express();

const myCache = new NodeCache({stdTTL: 60});  //{stdTTL: 60} time to live = 60 seconds


mongoose.connect('mongoDB URI', {useNewUrlParser: true, useUnifiedTopology: true});

// creating schema for time stamp
const lastScraped = new mongoose.Schema({
  time: {type: Number, default: Date.now()}
});

const LastScraped = mongoose.model("LastScraped", lastScraped);


// creating schema for scraped data
const covidSchema = new mongoose.Schema({
  order: Number,
  country: String,
  totalCases: String,
  newCases: String,
  totalDeaths: String,
  newDeaths: String,
  totalRecovered: String,
  activeCases: String,
  seriousCritical: String,
  totCasesPer1M: String,
  deathsPer1M: String,
  totalTests: String,
  testsPer1M: String,
  population: String,
  updatedTime: Number
});

const CovidData = mongoose.model("CovidData", covidSchema);











// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ scraping function @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@

const ScrapeCovid = async function scrapeCovid(url){
  const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
  const page = await browser.newPage();
  await page.goto(url);

  //scraping the data
  var scrapedData = await page.evaluate(function() {
    const tds = Array.from(document.querySelectorAll("tbody [style]"));
    return tds.map(td => td.innerText);
  });


  // using Regular Expression to parse useful data from scraped data
  const regexx = /(\d){1,3}\s+(\s?[éçA-Za-z\.\s?\-]+){1,3}(\s+((([+]?)\d+([,\.])?)+|N\/A)){5,12}\s/;
  var covidRowColumnTable = [];
  var rowCount = 0;
  for (var item of scrapedData){

    if (regexx.test(String(item)) === true && item.includes("\t") === true){
      covidRowColumnTable.push(item);
      rowCount++;
    }
    if (rowCount > 218){
      console.log("all items recived");
      break;
    }
  }

  //spliting column data into individual array elements thus creating a 2D array of row and columns
  for(var sentence = 0; sentence < covidRowColumnTable.length; sentence++){
    covidRowColumnTable[sentence] = covidRowColumnTable[sentence].split('\t');   //spliting column data into individual array elements
  }

  //deleting all of the scraped covid data from the database
  await CovidData.deleteMany({}, function(err){
    if(err){
      console.log("there was an error deleting all covid data from database and it was: " +  err);
    }else{
      console.log("sucesssfully deleted all covid documents");
    }
  });

  // adding newly scraped data into the database
  for(var row = 0; row < covidRowColumnTable.length; row++){
    const newCovidData = new CovidData({
      order: row+1,
      country: covidRowColumnTable[row][1],
      totalCases: covidRowColumnTable[row][2],
      newCases: covidRowColumnTable[row][3],
      totalDeaths: covidRowColumnTable[row][4],
      newDeaths: covidRowColumnTable[row][5],
      totalRecovered: covidRowColumnTable[row][6],
      activeCases: covidRowColumnTable[row][7],
      seriousCritical: covidRowColumnTable[row][8],
      totCasesPer1M: covidRowColumnTable[row][9],
      deathsPer1M: covidRowColumnTable[row][10],
      totalTests: covidRowColumnTable[row][11],
      testsPer1M: covidRowColumnTable[row][12],
      population: covidRowColumnTable[row][13]

    });

    await newCovidData.save();
  }

  //deleting from the database the time that the last web scrape took place
  await LastScraped.deleteMany({}, function(err){
    if(err){
      console.log("there was an error deleting the time stamp and it was: " +  err);
    }else{
      console.log("sucesssfully deleted all timestamp documents");
    }
  });

  const newTime = new LastScraped({
    time: Date.now()
  });

  await newTime.save();

  await browser.close();
  return;

};




//global
var lastTopRequestNumber = -1;
var timeSinceScrape = null;
var lastScrapedObj = {};


// @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ API GET @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
app.get("/covid", async function(req, res){

  //scraping time stamp from database. if no timestamp found in database, a new one will be created

  await LastScraped.findOne({}, async function(err, dbScrapedTime){
    if(err){
      console.log("there was an error quering the timestamp data because: " + err);
    }else{


      if(!dbScrapedTime){    //if timestamp not found in database, create a new one
        timeSinceScrape = 0;
        lastScrapedObj = {time: Date.now()}; // creating a timestamp object

      }else{
        timeSinceScrape = Date.now() - dbScrapedTime.time ;   //if timestamp exists, get the time in miliseconds from when the last scrape took place
        lastScrapedObj = {time: dbScrapedTime.time}; // creating a timestamp object
      }

      console.log("the database time is: " + lastScrapedObj.time);
      // 900000.0 ms is 15 minutes

    }

  });


  //checking if the timestamp is cached and the endpoint query requested the timestamp
  if(myCache.has("scrapedTime") === true && req.query.time == 1){
    console.log("Scraped time from cache: " + myCache.get("scrapedTime").time);
    res.send(JSON.stringify(myCache.get("scrapedTime")));
    return;
  }else if(myCache.has("scrapedTime") === false && req.query.time == 1){ //checking if the timestamp is not cached and the endpoint query requested the timestamp
    console.log("Scraped time from database: " + lastScrapedObj.time);
    myCache.set("scrapedTime", lastScrapedObj);
    res.send(JSON.stringify(lastScrapedObj));
    return;
  }


  // //if it has been over 15 minutes since the last timestamp. we need to scrape new data. the code below does this
  if(timeSinceScrape > 900000.0 || timeSinceScrape === 0){
    await ScrapeCovid("https://www.worldometers.info/coronavirus/").then( async function(){
      await CovidData.find({}, async function(err, dbNewData){
        if(err){
          console.log(err);
        }else{
          console.log("Succesfully scraped new data and put into database...");
        }
      });
    });
  }

  //checking if the last request for the top number of covid datas is still the same (ex: last request is top 15 and current is top 15 again, then we know to use cached data)
  if(req.query.top !== undefined && lastTopRequestNumber === -1){
    lastTopRequestNumber = Number(req.query.top);
    console.log("record taken");
  }else if(req.query.top !== undefined && lastTopRequestNumber !== Number(req.query.top)){ //if the new top number rquest is different. we need to update the variable
    lastTopRequestNumber = Number(req.query.top);
    console.log("new record");
  }

  //checking if all of the covid data is cached and to check the endpoint query did not request a subset of the covid data (ex: top 15 countries/ territories most affected)
  if(myCache.has("allCovidData") === true && req.query.top === undefined){
    console.log("All covid data from cache");
    res.send(JSON.stringify(myCache.get("allCovidData")));
    return;

  }else if(myCache.has("topCovidData") === true && Number(req.query.top) === lastTopRequestNumber){ //checking if endpoint query requested subset of the covid data
    console.log("Top covid data: " + lastTopRequestNumber);
    res.send(JSON.stringify(myCache.get("topCovidData")));
    return;

  }else if(myCache.has("topCovidData") === false && req.query.top !== undefined){ //if endpoint query requested subset of the covid data but the data was not cached, run the code below
    await CovidData.find({order: {$lte: Number(req.query.top)}}, async function(err, dbNewData){
      if(err){
        console.log(err);
      }else{
        console.log("Queried covid data from database");
        await res.send(JSON.stringify(dbNewData));
        myCache.set("topCovidData", dbNewData);
        return;
      }

    });
  }else{ //if all covid data is not cached and the user requested all covid data, then run the code below

    await CovidData.find({}, async function(err, dbNewData){
      if(err){
        console.log(err);
      }else{
        console.log("All covid data from database");
        await res.send(JSON.stringify(dbNewData));
        myCache.set("allCovidData", dbNewData);
        return;
      }

    });

  }


});



app.listen(PORT, function(){
  console.log(`server started on port ${PORT}`);
});
