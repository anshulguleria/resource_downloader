const https = require('https');
const url = require('url');
const fs = require('fs');
const util = require('util');
const downloadInfo = require('./download_meta');

let debug = false;

let args = process.argv.slice(2);
if(args.includes('--debug=true')) {
    debug = true;

}



let writeFile = util.promisify(fs.writeFile);
let requestTimeout = 30000; // 30 secs

let loader = {
    0: "|",
    1: "/",
    2: "\\",
    3: "|",
    current: 0
};

function getResource(urlString, headers, encoding="utf8") {
    let urlObj = url.parse(urlString);

    const defaultHeaders = {
        "User-Agent": "javascript"
    };

    headers = Object.assign({}, defaultHeaders, headers);

    let callPromise = new Promise((resolve, reject) => {
        https.get({
            hostname: urlObj.hostname,
            path: urlObj.path,
            headers: headers,
            timeout: requestTimeout
        }, (res) => {
            let { statusCode } = res;

            if(statusCode !== 200) {
                reject(`Request failed. Status Code: ${statusCode}`);
            }

            res.setEncoding(encoding);


            if(debug) {
                console.log(`Reading ${urlString}`);
            }
            var data = "";
            res.on('data', (chunk) => {
                if(debug) {
                    loader.current = (loader.current + 1) % 4;
                    console.log(`[Reading ${loader[loader.current]} ${new Date().toString()}]`);
                }
                data += chunk;
            });

            res.on('end', () => {
                resolve(data);
            });

        });
    });


    return callPromise;
}

var resCount = 2;
// Read offset from file since downloads gets discontinued
// sometimes
var offset = 0;
if(downloadInfo.reached) {
    offset = downloadInfo.reached;
}

var resourceUrl = `https://fanart.na.leagueoflegends.com/v1/art/na/?limit_to=${resCount}&offset=${offset}&ordering=-created`;

var batches = 0;
// Calculated batches as per completed offset
batches = offset / resCount;

var maxBatches = 350;
var coolDownDuration = 0; //10000; // 10 secs

var downloadedResources = new Set();

console.log(`Running script for ${maxBatches} batches of ${resCount} resources each.`);
console.log(`Starting from ${offset}`);

function sanitizeName(name) {
    return name
    .replace(/\//g, '~')
    .replace(/ /g, '_');
}

function fetchAndSaveImages (data) {
    data = JSON.parse(data);

    let images = data.results.map((resultItem) => {
        let originalImage = resultItem.images.original.url;
        return {
            title: resultItem.title,
            owner: resultItem.owner,
            region: resultItem.region,
            url: originalImage
        };
    });

    // Download images
    let downloadPromises = [];

    images.forEach((img) => {
        let fileName = [
            sanitizeName(img.owner),
            sanitizeName(img.region),
            sanitizeName(img.title)
        ].join('_');

        let fileExt = img.url.slice(img.url.lastIndexOf('.'));

        fileName = "downloads/" + fileName + fileExt;

        downloadPromises.push(getResource(img.url, {}, "binary").then((data) => {
            // Chain write operation
            return writeFile(fileName, data, { encoding: 'binary' }).then(() => {
                return `Created ${fileName}`;
            });
        }));
    });

    Promise.all(downloadPromises).then((results) => {
        console.log(results);

        results.forEach((imgPath) => {
            downloadedResources.add(imgPath);
        });
        console.log("====================\n");
        batches++;

        // Update downloadInfo
        downloadInfo.reached = batches * resCount;
        console.log("***************");
        console.log(new Date().toString());
        console.log(`Downloaded ${downloadInfo.reached} files.`);
        console.log("***************");
        // write this to file also
        writeFile("download_meta.json", JSON.stringify(downloadInfo, null, 2));

        if(data.next) {
            if(batches < maxBatches) {
                if(batches % 5 === 0) {
                    // Take cooldown time since servers block
                    // too much of load
                    console.log("#################");
                    console.log(`Taking cooldown time for ${coolDownDuration/1000} secs`);
                    console.log("#################");

                    setTimeout(() => {
                        getResource(data.next).then(fetchAndSaveImages);
                    }, coolDownDuration);
                } else {
                    getResource(data.next).then(fetchAndSaveImages);
                }
            } else {
                console.log(`Max batch limit of ${maxBatches} reached`);
            }

        } else {
            console.log(`Resource exhausted(${data.count})`);
            console.log(downloadedResources.entries().length);
        }
    }, (err) => {
        console.log(err);
        console.log(`Completed: ${batches} batches of ${resCount}`);
        // exit of failure
        process.exit(1);
    });
}

getResource(resourceUrl).then(fetchAndSaveImages);
