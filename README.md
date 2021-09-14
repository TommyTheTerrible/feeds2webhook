# feeds2webhook
Checks for updates in Twitter and RSS feeds then sends a webhook (to Discord) when new item found.

Requires a feeds.json file to be created with a list of sources and webhooks, like that in the feeds-example.json.

Here is a shortened example of the json file. The first item is a Twitter feed being sent to two webhooks. The second is an RSS feed being sent to a single webhook.

```

[
    {
        "url": "https://twitter.com/MadamNazarIO",
        "username": "Madam Nazar",
        "webhooks": [
            "https://example.com/api/webhooks/importantID-01/hopefullyyougetthepointbynow",
            "https://example.com/api/webhooks/importantID-01/ifyourenotgettingitbynowaskforhelp"
        ]
    },

    {
        "url": "https://community.secondlife.com/rss/1-blog-rss.xml",
        "username": "Second Life Community",
        "userimage": "https://content.invisioncic.com/Mseclife/monthly_2020_06/SL_logo_favicon_96x96.png",
        "webhooks": [
            "https://example.com/api/webhooks/importantID-01/snarkycommentnumberfive"
        ]
    },
]

```


Also, if using Twitter you will need to set an environment variable called TWITTER_BEARER_TOKEN to the API token Twitter gives you for developer access.
