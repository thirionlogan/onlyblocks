const needle = require('needle');
const util = require('util');
const token = process.env.BEARER_TOKEN;
const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules';
const streamURL = 'https://api.twitter.com/2/tweets/search/stream';
const rules = [
  {
    value: 'url:"https://onlyfans.com" -is:retweet',
    tag: 'onlyfans link',
  },
];

function expandObject(obj) {
  return util.inspect(obj, { showHidden: false, depth: null });
}

async function getAllRules() {
  const response = await needle('get', rulesURL, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (response.statusCode !== 200) {
    console.log(
      'Error:',
      expandObject(response.statusMessage),
      response.statusCode
    );
    throw new Error(response.body);
  }

  return response.body;
}

async function deleteAllRules(rules) {
  if (!Array.isArray(rules.data)) {
    return null;
  }

  const ids = rules.data.map((rule) => rule.id);

  const data = {
    delete: {
      ids: ids,
    },
  };

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
  });

  if (response.statusCode !== 200) {
    throw new Error(response.body);
  }

  return response.body;
}

async function setRules() {
  const data = {
    add: rules,
  };

  const response = await needle('post', rulesURL, data, {
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(response.body);
  }

  return response.body;
}

function streamConnect(retryAttempt) {
  const stream = needle.get(streamURL, {
    headers: {
      'User-Agent': 'v2FilterStreamJS',
      Authorization: `Bearer ${token}`,
    },
    timeout: 20000,
  });

  stream
    .on('data', (data) => {
      try {
        const json = JSON.parse(data);
        console.log(json);
        // A successful connection resets retry count.
        retryAttempt = 0;
      } catch (e) {
        if (
          data.detail ===
          'This stream is currently at the maximum allowed connection limit.'
        ) {
          console.log(data.detail);
          process.exit(1);
        } else {
          // Keep alive signal received. Do nothing.
        }
      }
    })
    .on('err', (error) => {
      if (error.code !== 'ECONNRESET') {
        console.log(error.code);
        process.exit(1);
      } else {
        // This reconnection logic will attempt to reconnect when a disconnection is detected.
        // To avoid rate limits, this logic implements exponential backoff, so the wait time
        // will increase if the client cannot reconnect to the stream.
        setTimeout(() => {
          console.warn('A connection error occurred. Reconnecting...');
          streamConnect(++retryAttempt);
        }, 2 ** retryAttempt);
      }
    });

  return stream;
}

function blockUsers(data) {
  try {
    const json = JSON.parse(data);
    // Block users
    json.forEach((tweet) => {
      needle(
        'post',
        `https://api.twitter.com/1.1/blocks/create.json?user_id=${tweet.author_id}&skip_status=1`,
        {
          'content-type': 'application/json',
          headers: { authorization: `Bearer ${token}` },
        }
      ).then(() => {
        console.log('user', tweet.author_id, 'blocked for tweet: ');
        console.log(tweet.text);
      });
    });

    // A successful connection resets retry count.
    retryAttempt = 0;
  } catch (e) {
    if (
      data.detail ===
      'This stream is currently at the maximum allowed connection limit.'
    ) {
      console.log(data.detail);
      process.exit(1);
    } else {
      // Keep alive signal received. Do nothing.
    }
  }
}

(async () => {
  let currentRules;

  try {
    // Gets the complete list of rules currently applied to the stream
    currentRules = await getAllRules();
    if (!currentRules.data?.length) await setRules();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  // Listen to the stream.
  streamConnect(0).on('data', blockUsers);
})();
