// const express = require('express');
const fs = require('fs');
// const app = express();

// api v
// https://the-odds-api.com/liveapi/guides/v4/#parameters-2
const URL = "https://api.the-odds-api.com/v4/"; 
const API_KEY = process.env.API_KEY;

const errorCheck = (status) => {
    if (status !== 200) throw new Error("API Error, Error Code: " + status);
}
// server.listen(8080, console.log("Listening on port 8080"));
/**
 * 
 * @returns the sport keys, and descriptions.
 */
const getAllSports = async (onlyOutrights) => {
    let finalUrl = `${URL}sports/?apiKey=${API_KEY}`;
    const resp = await fetch(finalUrl);
    errorCheck(resp.status);
    const data = await resp.json();
    console.log(data);
    return data;
};

/**
 * 
 * @param {string} sport key of what sport you want to search the odds for
 * @param {*} regions what regions you want (comma separated for multiple)
 * @returns json object of the data. 
 * 
 * Format of return Object:
 * [
 *  {
 *      bookmakers: [ {
 *          markets: [ { outcomes: [{name, price}, {name, price}] } ]
 *      } ]
 *  },
 * ]
 */
const getOdds = async (sport, regions) => {
    let finalUrl = `${URL}sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=h2h,totals&dateFormat=unix`;
    const resp =  await fetch(finalUrl);
    errorCheck(resp.status);
    const data = await resp.json();
    return data;
}

const checkForArbH2H = (nodes, title, betAmount=100) => {
    let minABookie = "";
    let maxABookie = "";
    let maxHBookie = "";
    let minHBookie = "";
    let minA = minH = 99999999999;
    let maxA = maxH = -1;

    for (node of nodes) {
        let tempH = parseFloat(node.home_odds.split(":")[1]);
        let tempA = parseFloat(node.away_odds.split(":")[1]);

        if (tempA < minA) {
            minABookie = node.bookie;
            minA = tempA;
        }
        if (tempH < minH){
            minHBookie = node.bookie;
            minH = tempH;
        }
        if (tempA > maxA){
            maxABookie = node.bookie;
            maxA = tempA;
        }
        if (tempH > maxH) {
            maxHBookie = node.bookie;
            maxH = tempH;
        }
        const outlay = (1000 / minA) + (1000 / maxH);
        const outlay2 = (1000 / minH) + (1000 / maxA);
        const test = Math.max(outlay, outlay2);

        // console.log(`${test}:$ ${1000 - test}`);
    }

    const outlay = (betAmount / minA) + (betAmount / maxH);
    const outlay2 = (betAmount / minH) + (betAmount / maxA);
    const test = Math.max(outlay, outlay2);
    if (betAmount - test > 0) {
        let team1, team2;
        if (test === outlay){
            team1 = minABookie;
            team2 = maxHBookie;
        } else {
            team1 = maxABookie;
            team2 = minHBookie;
        }
        console.log(`Arbitrage Detected For Game ${title}:\n${team2}: ${maxH} -Home | ${team1}: ${minA} -Away |  Outlay - ${test} `);
        return true;
    }
    return false;
}

const checkForArbTotals = (nodes, title, betAmount=1000) => {
    let maxOver = -1, minOver = 9999, minUnder = 9999, maxUnder = -1;
    let bookieMXO, bookieMNO, bookieMNU, bookieMXU;
    if (Object.keys(nodes).length < 2) return false;
    for (const point of Object.keys(nodes)) {
        // get the max and min betting lines for the over.
        for(let temp of nodes[point].over) {
            maxOver = Math.max(maxOver, temp.price);
            minOver = Math.min(minOver, temp.price);
            bookieMXO =  maxOver == temp.price ? temp.bookie: bookieMXO;
            bookieMNO = minOver == temp.price ? temp.bookie: bookieMNO;
        }
        //get max and min, along with the bookies of the under.
        for(let temp of nodes[point].under) {
            maxUnder = Math.max(maxUnder, temp.price);
            minUnder = Math.min(minUnder, temp.price);
            bookieMXU =  maxUnder == temp.price ? temp.bookie: bookieMXU;
            bookieMNU = minUnder == temp.price ? temp.bookie: bookieMNU;
        }

        const outlay = (betAmount / minUnder) + (betAmount / maxOver);
        const outlay2 = (betAmount / minOver) + (betAmount / maxUnder);
        const test = Math.max(outlay, outlay2);


        // console.log(`TESTING: ${title}|${bookieMXO}:${maxOver} | ${bookieMNU}:${minUnder} = ${outlay}`);
        // console.log(`TESTING: ${title}|${bookieMXU}:${maxUnder} | ${bookieMNO}:${minOver} = ${outlay2}`);

        if (betAmount - test > 0) {
            if (test == outlay) {
                console.log(`Arbitrage Found: ${title} Over:${bookieMXO}/Under:${bookieMNU}: ${point}`);
            } else {
                console.log(`Arbitrage Found: ${title} Over:${bookieMXU}/Under:${bookieMNO}: ${point}`);
            }
        }
    }
    return false;
}

const parseData = (data) => {
    const handleDate = (dateISO) => {
        const date = new Date(dateISO * 1000);
        return date;
    }

    let games = {};
    for (let game of data) {
        const {id, sport_title, sport_key, home_team, away_team, commence_time} = {...game};
        const start_time = handleDate(commence_time); // unix
        
        const node = {
            id,
            sport_title,
            sport_key,
            start_time,
            home_team,
            away_team,
            odds: {
                h2h: [],
                totals: {}
            }
        }        
        // only looking for moneylines. (head to head)
        for (let bookies of game.bookmakers) {
            // const {outcomes} = bookies.markets.filter(d => d.key == "h2h")[0];

            // bookie name (draftkings, bet365 etc)
            const bookie = bookies?.title;
            // const home_odds = outcomes[0].name + ":" + outcomes[0].price;
            // const away_odds = outcomes[1].name + ":" + outcomes[1].price;
            for (let market of bookies.markets) {
                let node2;
                // console.log(market);
                if (market.key.includes("h2h")) {
                    const home_odds = market.outcomes[0].name + ":" + market.outcomes[0].price;
                    const away_odds = market.outcomes[1].name + ":" + market.outcomes[1].price;
                    market.key = "h2h";
                    node2 = {
                        bookie,
                        home_odds,  // of the markets that they have on this game
                        away_odds,  // store the bookie title, and the odds in bookies.
                    }
                    node.odds.h2h.push(node2);
                } else {
                    for (const i in market.outcomes){
                        const {name, price, point} = {...market.outcomes[i]}
                        if (!node?.odds?.totals[point]) node.odds.totals[point] = { over: [], under: []};
                        node.odds.totals[point][name.toLowerCase()].push({
                            bookie,
                            price,
                        });
                    }
                    // console.log(node.odds);
                }
            }
        }
        
        const gameKey = (home_team + "|" + away_team + "|" + start_time.toDateString()).replaceAll(" ", "_");
        games[gameKey] = node;
    }
    return games;
}

async function main() {

    const data = await getOdds("upcoming", regions="us,us2,uk,eu");

    const games = parseData(data); // dictionary of the games.

    for (gameKey of Object.keys(games)) {
        checkForArbH2H(games[gameKey].odds.h2h, gameKey);
        checkForArbTotals(games[gameKey].odds.totals, gameKey);
        fs.writeFileSync(`games/${gameKey}.json`, JSON.stringify(games[gameKey]), ()=>{});
    }

}

main();