// const express = require('express');
const fs = require('fs');
// const app = express();

// api v
// https://the-odds-api.com/liveapi/guides/v4/#parameters-2
const URL = "https://api.the-odds-api.com/v4/"; 
const API_KEY = process.env.API_KEY;
const disallowedInUS = ["Matchbook", "Betfair", "1xBet", "Circa Sports"] // circa only in nevada iowa and colorado

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
 *      bookmakers: [ { // every "bookie" has their own markets for each "outcome" of any game
 *          markets: [ { outcomes: [{name, price}, {name, price}] } ]
 *      } ]
 *  },
 * ]
 */
const getOdds = async (sport, regions) => {
    let finalUrl = `${URL}sports/${sport}/odds/?apiKey=${API_KEY}&regions=${regions}&markets=h2h,totals&dateFormat=unix`;
    const resp =  await fetch(finalUrl);
    errorCheck(resp.status);
    // console.log(resp);
    const data = await resp.json();
    return data;
}

const checkForArbH2H = (nodes, title, betAmount=1000) => {
    let maxABookie = "";
    let maxHBookie = "";
    let maxA = -1;
    let maxH = -1;

    // track the max/min payout for each bookie
    for (node of nodes) {
        if (disallowedInUS.includes(node.bookie)) continue;
        let tempH = parseFloat(node.home_odds.split(":")[1]);
        let tempA = parseFloat(node.away_odds.split(":")[1]);
        if (tempA > maxA){
            maxABookie = node.bookie;
            maxA = tempA;
        }
        if (tempH > maxH) {
            maxHBookie = node.bookie;
            maxH = tempH;
        }
    }

    // percentage odds for each bet
    const odds = (1 / maxH) * 100;
    const odds2 = (1/maxA) * 100;
    // arbitrage percentage.
    const arbitrage = odds + odds2;
    const betAmountHome = (betAmount * odds) / arbitrage;
    const betAmountAway = (betAmount * odds2) / arbitrage;

    if (arbitrage < 100)
        return (`Arbitrage found for ${title} :\n\t
         Home - ${maxHBookie} | Odds - ${maxH} $${betAmountHome}\n\t 
         Away - ${maxABookie} | Odds - ${maxA} $${betAmountAway}`
         );
    return -1;
}

// arbitrage check for over/under bets.
const checkForArbTotals = (nodes, title, betAmount=1000) => {
    let maxOver = -1, maxUnder = -1;
    let bookieMXO, bookieMXU;
    let arbs = [];
    if (Object.keys(nodes).length < 2) return arbs;
    for (const point of Object.keys(nodes)) {
        // get the max betting lines for the over bet.
        for(let temp of nodes[point].over) {
            if (disallowedInUS.includes(temp.bookie)) continue;
            maxOver = Math.max(maxOver, temp.price);
            bookieMXO =  maxOver == temp.price ? temp.bookie: bookieMXO;
        }
        //get max along with the bookies of the under bet.
        for(let temp of nodes[point].under) {
            if (disallowedInUS.includes(temp.bookie)) continue;
            maxUnder = Math.max(maxUnder, temp.price);
            bookieMXU =  maxUnder == temp.price ? temp.bookie: bookieMXU;
        }
        const odds1 = (1 / maxUnder) * 100
        const odds2 =  (1 / maxOver) * 100;
        const arbitrage = odds1 + odds2;
        const betAmountHome = (betAmount * odds1) / arbitrage;
        const betAmountAway = (betAmount * odds2) / arbitrage;

        if (arbitrage < 100) {
            arbs.push(`Arbitrage found for ${title} O/U - ${point}:\n\t 
            Over - ${bookieMXO} | Odds - ${maxOver} $${betAmountHome}\n\t 
            Under - ${bookieMXU} | Odds - ${maxUnder} $${betAmountAway}\n`
            );
        }
    }
    return arbs.length > 0 ? arbs: -1;
}

//TODO: finish this
const checkForArb3Way = async (eventID, sport_key, regions="us,us2") => {
    const finalUrl = `${URL}sports/${sport_key}/events/${eventID}/odds?apiKey=${API_KEY}&regions=${regions}&markets=h2h_3_way&dateFormat=unix`;
    const resp = await fetch(finalUrl);
    errorCheck(resp.status);
    const data = await resp.json();
    if (data?.bookmakers?.length > 0)
        return data;
    return -1;
}

// format data from api.
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
            // bookie name (draftkings, bet365 etc)
            const bookie = bookies?.title;
            for (let market of bookies.markets) {
                let node2;
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
                } else if (market.key.includes("totals")){
                    for (const i in market.outcomes){
                        const {name, price, point} = {...market.outcomes[i]}
                        if (!node?.odds?.totals[point]) node.odds.totals[point] = { over: [], under: []};
                        node.odds.totals[point][name.toLowerCase()].push({
                            bookie,
                            price,
                        });
                    }
                }
            }
        }
        
        const gameKey = (home_team + " - HOME |" + away_team + " - AWAY|" + start_time.toDateString()).replaceAll(" ", "_");
        games[gameKey] = node;
    }
    return games;
}



async function main() { 

    const data = await getOdds("upcoming", regions="us,us2");

    const games = parseData(data); // dictionary of the games.
    // console.log(games);
    // loop through each event id.
    let arbs;
    for (gameKey of Object.keys(games)) {
        const data2 = await checkForArb3Way(games[gameKey].id, games[gameKey].sport_key); // -1 for no odds
        // console.log(data2);
        arbs = checkForArbH2H(games[gameKey].odds.h2h, gameKey);
        if (arbs !== -1 && arbs?.length > 0) console.log(arbs);
        arbs = checkForArbTotals(games[gameKey].odds.totals, gameKey);
        if (arbs !== -1 && arbs?.length > 0) console.log(arbs);
        // fs.writeFileSync(`games/${games[gameKey].id}.json`, JSON.stringify(data2));
        // fs.writeFileSync(`games/${gameKey}.json`, JSON.stringify(games[gameKey]), ()=>{});
    }

}

main();