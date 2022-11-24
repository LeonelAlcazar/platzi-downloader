const puppeteer = require("puppeteer");
const puppeteerAfp = require("puppeteer-afp");
const fs = require("fs");
const exec = require("child_process").exec;
const axios = require("axios");
const m3u8 = require("m3u8-parser");
const cliProgress = require("cli-progress");

const chromeExecutable = "/usr/bin/microsoft-edge";

if (!fs.existsSync("./outputs")) {
  fs.mkdirSync("./outputs");
}

async function FragmentMethod(videoStream, audioStream, manifestUrl, callback) {
  const bar1 = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );
  try {
    const parser = new m3u8.Parser();
    const manifestResponse = await axios.get(manifestUrl, {
      headers: {
        Referer: "https://platzi.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
      },
    });
    parser.push(manifestResponse.data);
    parser.end();
    const manifest = parser.manifest;
    const baseUrl = manifestUrl.split("/").slice(0, -1).join("/");
    const videoResponse = await axios.get(
      baseUrl + "/" + manifest.playlists.at(-1).uri,
      {
        headers: {
          Referer: "https://platzi.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
        },
      }
    );
    const videoUrl = (baseUrl + "/" + manifest.playlists.at(-1).uri)
      .split("/")
      .slice(0, -1)
      .join("/");
    const videoManifest = videoResponse.data;
    const audioResponse = await axios.get(
      baseUrl + "/" + manifest.mediaGroups.AUDIO.audio.aac_UND_2_129.uri,
      {
        headers: {
          Referer: "https://platzi.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
        },
        responseType: "blob",
      }
    );
    const audioUrl = (
      baseUrl +
      "/" +
      manifest.mediaGroups.AUDIO.audio.aac_UND_2_129.uri
    )
      .split("/")
      .slice(0, -1)
      .join("/");
    const audioManifest = audioResponse.data;

    const videoFragments = videoManifest
      .split("\n")
      .filter((line) => line.includes("Fragments("));
    const audioFragments = audioManifest
      .split("\n")
      .filter((line) => line.includes("Fragments("));

    bar1.start(videoFragments.length + audioFragments.length, 0);
    let i = 0;
    for (let videoFragment of videoFragments) {
      bar1.update(i);

      const raw = await axios.get(videoUrl + "/" + videoFragment, {
        headers: {
          Referer: "https://platzi.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
        },
        responseType: "arraybuffer",
      });
      videoStream.write(Buffer.from(raw.data, "binary"));
      i++;
    }

    for (let audioFragment of audioFragments) {
      bar1.update(i);

      const raw = await axios.get(audioUrl + "/" + audioFragment, {
        headers: {
          Referer: "https://platzi.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
        },
        responseType: "arraybuffer",
      });
      audioStream.write(Buffer.from(raw.data, "binary"));
      i++;
    }
    bar1.stop();
    callback();
  } catch (e) {
    bar1.stop();
    console.log(e);
    throw e;
  }
}

async function m3u8Method(videoStream, manifestUrl, callback) {
  const bar1 = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );
  try {
    const parser = new m3u8.Parser();
    const manifestResponse = await axios.get(manifestUrl, {
      headers: {
        Referer: "https://platzi.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
      },
    });
    parser.push(manifestResponse.data);
    parser.end();
    const manifest = parser.manifest;
    const baseUrl = manifestUrl.split("/").slice(0, -1).join("/");
    bar1.start(manifest.segments.length, 0);
    let i = 0;
    for (let segment of manifest.segments) {
      bar1.update(i);
      const raw = await axios.get(baseUrl + "/" + segment.uri, {
        headers: {
          Referer: "https://platzi.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36",
        },
        responseType: "arraybuffer",
      });
      videoStream.write(Buffer.from(raw.data, "binary"));
      i++;
    }
    bar1.stop();

    callback();
  } catch (e) {
    bar1.stop();

    throw e;
  }
}

function FetchVideo(browser, video) {
  return new Promise(async (resolve, reject) => {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: false,
        executablePath: "/usr/bin/microsoft-edge",
      });
    }

    const newPage = await browser.newPage();
    const page = puppeteerAfp(newPage);
    await page.setRequestInterception(true);

    let videoStream = fs.createWriteStream(video.folder + "/video");
    let audioStream = fs.createWriteStream(video.folder + "/audio");
    let paths = [];
    let videoConfigUrl = null;
    let audioConfigUrl = null;
    let manifestUrl = null;
    let method = "fragments";
    page.on("request", async (request) => {
      if (
        request.url().includes("manifest(") ||
        request.url().includes(".m3u8")
      ) {
        console.log(request.url());
        //paths.push(request.url());

        /*if (request.url().includes("aac_UND_2_129")) {
          audioConfigUrl = request.url();
        }
        if (request.url().includes("video")) {
          audioConfigUrl = request.url();
        }*/

        if (request.url().includes("manifest(")) {
          manifestUrl = request.url();
          console.log("CATCHED");
          await FragmentMethod(
            videoStream,
            audioStream,
            manifestUrl,
            async () => {
              await page.close();

              var proc = exec(
                `ffmpeg -i ${video.folder}/video -i ${video.folder}/audio -c:v copy -c:a aac ${video.folder}/${video.title}.mp4`,
                (error, stdout, stderr) => {
                  exec(`rm ${video.folder}/video`);
                  exec(`rm ${video.folder}/audio`);
                  resolve();
                }
              );
            }
          );
        } else if (request.url().includes(".m3u8")) {
          manifestUrl = request.url();
          console.log("CATCHED2");

          await m3u8Method(videoStream, manifestUrl, async () => {
            await page.close();
            var proc = exec(
              `ffmpeg -i ${video.folder}/video -acodec copy -vcodec copy ${video.folder}/${video.title}.mp4`,
              (error, stdout, stderr) => {
                exec(`rm ${video.folder}/video`);
                exec(`rm ${video.folder}/audio`);
                resolve();
              }
            );
          });
        }

        request.continue();

        //process.exit();
      } else {
        request.continue();
      }
    });
    let c = 0;

    await page.goto("https://platzi.com" + video.href, { timeout: 0 });
    page.exposeFunction("resolveFN", resolve);
    await page.evaluate(() => {
      const isLecture = document.querySelector(".Header-lecture");
      if (isLecture) {
        window.resolveFN();
      }
    });
  });
}

async function FetchCourse(browser) {
  return new Promise(async (resolve) => {
    const newPage = await browser.newPage();
    const page = puppeteerAfp(newPage);
    await page.goto(process.argv[2], { timeout: 0 });
    await page.exposeFunction("setFetchVideos", async (videos, title) => {
      if (!fs.existsSync("./outputs/" + title)) {
        fs.mkdirSync("./outputs/" + title);
      }
      for (let video of videos) {
        if (
          !fs.existsSync(
            "./outputs/" + title + "/" + video.title.replace("/", "/")
          )
        ) {
          fs.mkdirSync(
            "./outputs/" + title + "/" + video.title.replace("/", "/")
          );
        }

        await FetchVideo(browser, video);
      }
      resolve();
    });
    await page.evaluate(() => {
      const courseTitle = document
        .querySelector(".Hero-content-title")
        .textContent.replace(/\s/g, "-");
      const videos = document.querySelectorAll(".ContentBlock-list-item");
      const result = [];
      videos.forEach((video, i) => {
        const isQuiz = video.querySelector(".ContentQuiz") !== null;
        if (isQuiz) {
          return;
        }

        if (
          video.querySelector(".ContentClass-item-content > p").textContent ==
          "00:01 min"
        ) {
          return;
        }

        const title =
          `${i}-` +
          (
            video.querySelector(".ContentClass-item-content > h5")
              .textContent || "unknown"
          ).replace(/\s/g, "-");

        const href = video
          .querySelector(".ContentClass-item-link")
          .getAttribute("href");
        result.push({
          title,
          folder: "./outputs/" + courseTitle + "/" + title,
          href,
        });
      });

      window.setFetchVideos(result, courseTitle);
    });
  });
}

async function All() {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromeExecutable,
    //userDataDir: "/tmp/.com.microsoft.Edge.FdFfvg",
  });
  const newPage = await browser.newPage();
  const page = puppeteerAfp(newPage);

  await page.goto("https://platzi.com/login/", { timeout: 0 });
  page.on("framenavigated", async (frame) => {
    if (frame.url() === "https://platzi.com/home") {
      console.log("login");
      await FetchCourse(browser);
      await page.close();
      await browser.close();
    }
  });
}

All();
