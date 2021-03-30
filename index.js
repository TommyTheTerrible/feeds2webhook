const process = require('process');
const fs = require("fs");
const rssParser = new (require("rss-parser"))();
const htmlParser = require("node-html-parser");
const md5 = require("md5");
const fetch = require("node-fetch");
const needle = require('needle');

const feedsFilename = "feeds.json";
const hashesFilename = "hashes.json";
const UpdateTimeout = process.env.RSS_UPDATE_TIMEOUT || 60 * 1000 * 5;

const twitterCred = {
    bearer_token: process.env.TWITTER_BEARER_TOKEN
};

function LoadFeeds() {
    return JSON.parse(fs.readFileSync(__dirname+"/"+feedsFilename, "utf8"));
}

function LoadHashes() {
    try {
        return JSON.parse(fs.readFileSync(__dirname+"/"+hashesFilename, "utf8")) || {};
    } catch (error) {
        return {};
    }
}

function SaveHashes(hashes) {
    return fs.writeFileSync(__dirname+"/"+hashesFilename, JSON.stringify(hashes), "utf8");
}

async function GetRSSEntries(feedItem) {
    let feed = await rssParser.parseURL(feedItem.url);
    let hash = md5(feedItem.url);
    let entries = [];

    feed.items.forEach(function(entry) {

        let entryTitle = entry.title || "";
        let entryUrl = entry.link || "";
        let entryAuthor = entry.creator || "";
        let entryContent = entry.content || "";
        let entryPublished = entry.pubDate || "";

        let entryImageUrl;
        try {
            entryImageUrl = entry.enclosure.url;
        } catch (error) { }

        if (!entryImageUrl) {
            try {
                entryImageUrl = htmlParser
                    .parse(entry.content)
                    .querySelector("img")
                    .getAttribute("src");
            } catch (error) {
                entryImageUrl = "";
            }
        }

        entries.push({
            EntryTitle: entryTitle,
            EntryUrl: entryUrl,
            EntryAuthor: entryAuthor,
            EntryContent: entryContent,
            EntryPublished: entryPublished,
            EntryImageUrl: entryImageUrl
        });
    });

    return entries;
}

async function SendWebhook(webhookOptions, postBody, embed) {    

    let fetchBody = JSON.stringify({
        username: webhookOptions.username,
        avatar_url: webhookOptions.userimage,
        embeds: postBody
        });

    if(!embed) {
        fetchBody = JSON.stringify({
            username: webhookOptions.username,
            avatar_url: webhookOptions.userimage,
            content: postBody
            }); 
    }

        fetch(webhookOptions.url,{
                method: 'post',
                headers: {
                'Content-Type': 'application/json',
                },
                body: fetchBody
                }
        );
    let date = new Date();

    console.log("Webhook sent from " + webhookOptions.username + " @ " + date.toISOString());
}

async function getTwitterID(username) {

    const endpointURL = "https://api.twitter.com/2/users/by?usernames="

    // These are the parameters for the API request
    // specify User names to fetch, and any additional fields that are required
    // by default, only the User ID, name and user name are returned
    const params = {
        usernames: username, // Edit usernames to look up
        "user.fields": "created_at,description", // Edit optional query parameters here
        "expansions": "pinned_tweet_id"
    }

    // this is the HTTP header that adds bearer token authentication
    const res = await needle('get', endpointURL, params, {
        headers: {
            "User-Agent": "v2UserLookupJS",
            "authorization": `Bearer ${twitterCred.bearer_token}`
        }
    })

    if (res.body) {
        return res.body.data[0].id;
    } else {
        throw new Error('Unsuccessful request')
    }
}

const getUserTweets = async (userID) => {

    const url = `https://api.twitter.com/2/users/${userID}/tweets`;    

    let userTweets = [];

    // we request the author_id expansion so that we can print out the user name later
    let params = {
        "max_results": 5,
        "tweet.fields": "created_at",
        "expansions": "author_id"
    }

    const options = {
        headers: {
            "User-Agent": "v2UserTweetsJS",
            "authorization": `Bearer ${twitterCred.bearer_token}`
        }
    }

    let nextToken = null;
    let userName;    

    let resp = await getTwitterPage(params, options, nextToken, url);
    if (resp && resp.meta && resp.meta.result_count && resp.meta.result_count > 0) {
        userName = resp.includes.users[0].username;
        if (resp.data) {
            resp.data.sort(function(a,b){
                return new Date(a.created_at) - new Date(b.created_at);
              });
            userTweets.push.apply(userTweets, resp.data);
        }
    }   

    return userTweets;
}

const getTwitterPage = async (params, options, nextToken, url) => {
    if (nextToken) {
        params.pagination_token = nextToken;
    }

    try {
        const resp = await needle('get', url, params, options);

        if (resp.statusCode != 200) {
            //console.log(`${resp.statusCode} ${resp.statusMessage}:\n${resp.body}`);
            return;
        }
        return resp.body;
    } catch (err) {
        throw new Error(`Request failed: ${err}`);
    }
}

async function ProcessTwitterFeed(feedItem, hashes) {
    
    let feedHash = md5(feedItem.url);

    let feedURL = new URL(feedItem.url);

    let feedUser = feedURL.pathname.split('/')[1];

    let feedID = await getTwitterID(feedUser);

    let entries = await getUserTweets(feedID);

    let newItems = 0;
        
    let postBody = [];

    if(typeof hashes[feedHash] == 'undefined') hashes[feedHash] = [];

    let newHashes = [];

    entries.forEach(function(entry) {
            
        let entryHash = md5(entry.id);

        let hashEntry = {'hash': entryHash, 'date': entry.created_at};

        let entryFound = false;

        hashes[feedHash].forEach(function(row) {

            if (row.hash == entryHash) entryFound=true;

        });
            
        if(!entryFound) {
            var todaysDate = new Date();
            var tweetDate = new Date(entry.created_at);
            if(tweetDate.setHours(0,0,0,0) == todaysDate.setHours(0,0,0,0)) {
                let tweetlink = `https://twitter.com/${feedUser}/status/${entry.id}`
                postBody.push(tweetlink);
                newItems++;
            }
        }

        newHashes.push(hashEntry);

    });

    if(postBody.length > 0) {
        
        postBody.forEach(function(body) {
            feedItem.webhooks.forEach(function(webhook) {
                let webhookoptions = {'username':feedItem.username, 'userimage':feedItem.userimage, 'url':webhook};                    
                SendWebhook(webhookoptions, body, false);
            });            
        });

    }

    console.log(feedItem.username + " - Found " + newItems + " new of " + entries.length + " total." );

    return newHashes;

}


async function ProcessRSSFeed(feedItem, hashes) {
    
    let feedHash = md5(feedItem.url);

    let entries = await GetRSSEntries(feedItem);

    let newItems = 0;
        
    let postBody = [];

    if(typeof hashes[feedHash] == 'undefined') hashes[feedHash] = [];

    let newHashes = [];

    entries.forEach(function(entry) {
            
        let entryHash = md5(entry.EntryUrl);

        let hashEntry = {'hash': entryHash, 'date': entry.EntryPublished};

        let entryFound = false;

        hashes[feedHash].forEach(function(row) {

            if (row.hash == entryHash) entryFound=true;

        });
            
        if(!entryFound) {
            postBody.push({
                color: 11730954,
                title: entry.EntryTitle,
                url: entry.EntryUrl
            });
            newItems++;
        }

        newHashes.push(hashEntry);

    });

    if(postBody.length > 0) {

        // Discord has rate limiting for embeds so we break them up into groups of 10.

        var i,j,bodyChunk,chunk = 10;
        for (i=0,j=postBody.length; i<j; i+=chunk) {
            bodyChunk = postBody.slice(i,i+chunk);
            feedItem.webhooks.forEach(function(webhook) {
                let webhookoptions = {'username':feedItem.username, 'userimage':feedItem.userimage, 'url':webhook};                    
                SendWebhook(webhookoptions, bodyChunk, true);
            });            
        }
    }

    console.log(feedItem.username + " - Found " + newItems + " new of " + entries.length + " total." );

    return newHashes;

}

async function ProcessAllFeeds(feeds, hashes) {
    var processStart = new Date();
    console.log("Processing feeds at:", processStart.toUTCString());

    

    for (let index = 0; index < feeds.length; index++) {

        let feedHash = md5(feeds[index].url);
        let feedURL = new URL(feeds[index].url);

        if(feedURL.hostname.toLowerCase() == "twitter.com"){
            if(twitterCred.bearer_token){
                hashes[feedHash] = await ProcessTwitterFeed(feeds[index], hashes);
            } else {
                console.log("Twitter Token not found!");
            }               
        }
        else
        {
            hashes[feedHash] = await ProcessRSSFeed(feeds[index], hashes);
        }
    }

    SaveHashes(hashes);

}

// Entry point
(async () => {
    let feeds = LoadFeeds();
    let hashes = LoadHashes();
    
    if(twitterCred.bearer_token) console.log("Twitter Token found!");

    await ProcessAllFeeds(feeds, hashes); // Force first check
    let timerId = setInterval(
        async () => await ProcessAllFeeds(feeds, hashes),
        UpdateTimeout
    );
})();
