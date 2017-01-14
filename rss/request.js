const request = require('request'); // for fetching the feed
const sqlCmds = require('./sql/commands.js')

module.exports = function (link, feedparser, con, callback) {

  const req = request(link, function (error, response) {
    if (error || response.statusCode !== 200)
      console.log(`RSS Request Error: Problem occured while requesting from "${link}"`);
  });

  req.on('error', function (error) {
    console.log('RSS Request Error: ' + error)
    callback()
  });

  req.on('response', function (res) {
    var stream = this;

    if (res.statusCode !== 200) {
      this.emit('error', new Error(`Bad status code`));
    }
    else {
      stream.pipe(feedparser);
    }

  });

}
