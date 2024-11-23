const express = require("express");
const cors = require("cors");
const axios = require("axios");
const protobuf = require("protobufjs");
const fs = require("fs");

// gtfs-realtime.protoを読込
const loadProto = () => protobuf.load("./gtfs-realtime.proto");

// データの取得
const fetchData = async (source, isLocal = false) => {
  return isLocal
    ? fs.readFile(source) // ローカルファイルを読込
    : (await axios.get(source, { responseType: "arraybuffer" })).data; // リモートファイルを取得
};

// データを解析して配列を返す
const parseData = async (source, isLocal = false) => {
  try {
    const root = await loadProto();
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

    // データの取得
    const binaryData = await fetchData(source, isLocal);

    // デコードとオブジェクト化
    const message = FeedMessage.decode(binaryData);
    const parsedArray = FeedMessage.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
    }).entity;

    // console.log("Parsed Data Array:", JSON.stringify(parsedArray, null, 2));
    return parsedArray;
  } catch (error) {
    console.error("Error parsing data:", error);
    return [];
  }
};

/**
 * CSVデータを同期的に読み込み、stop_idに対応するstop_nameを返却する関数
 * @param {string} stopId - 検索するstop_id
 * @returns {string} - stop_nameまたは"無効データ"
 */
function getStopNameById(stopId) {
  try {
    // ファイル全体を同期的に読み込む
    const data = fs.readFileSync("ryobi/stops.txt", "utf-8");
    const rows = data.split("\n"); // 行単位で分割

    // CSVヘッダーを除外してデータをループ
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].trim().replace(/"/g, ""); // ダブルコーテーションをすべて除去

      if (!row) continue; // 空行をスキップ

      const columns = row.split(",");

      // stop_idが一致する行を探す
      if (columns[0] === stopId) {
        return columns[2] || "無効データ"; // stop_nameを返却
      }
    }

    return "無効データ"; // 見つからなかった場合
  } catch (error) {
    console.error("エラーが発生しました:", error);
    return "無効データ";
  }
}

const app = express();

app.use(cors());

app.get("/", async (req, res) => {
  let returnArray = null;
  const ryobiArray = await parseData(
    "https://loc.bus-vision.jp/realtime/ryobi_vpos_update.bin"
  );
  const ryobiArray2 = await parseData(
    "https://loc.bus-vision.jp/realtime/ryobi_trip_update.bin"
  );
  //   const ryobiArray = await parseData("./ryobi_vpos_update.bin", true);
  //   const ryobiArray2 = await parseData("./ryobi_trip_update.bin", true);

  // 配列のマージ
  if (ryobiArray !== undefined && ryobiArray2 !== undefined) {
    returnArray = ryobiArray.map((item1, index) => {
      const item2 = ryobiArray2[index];
      return {
        ...item1,
        tripUpdate: item2.tripUpdate,
        icon: "https://loc.bus-vision.jp/ryobi/view/images/common/busicon/10000/2/201_s.png",
        nextStopName: getStopNameById(item2.tripUpdate.stopTimeUpdate[item1.vehicle.currentStopSequence].stopId), // indexが1スタート
      };
    });

    // console.log(JSON.stringify(returnArray, null, 2));
    res.send(returnArray);
  }
});

app.listen(3000, () => console.log("Server ready on port 3000."));

module.exports = app;
