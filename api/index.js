const express = require("express");
const cors = require("cors");
const axios = require("axios");
const protobuf = require("protobufjs");
const fs = require("fs");
const path = require("path");

// gtfs-realtime.protoを読込
const loadProto = () =>
  protobuf.load(path.resolve(__dirname, "../data/", "./gtfs-realtime.proto"));

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
 * CSVデータを同期的に読み込み、対応する行の値を返却する関数
 * @param {string} filePath - CSVファイルのパス
 * @param {string} param - 検索する値
 * @param {number} searchColumnId - 検索するコラム列番号
 * @param {number} returnColumnId - 返却するコラム列番号
 * @returns {string} - コラムの値または"無効データ"
 */
function getColumnById(filePath, param, searchColumnId, returnColumnId) {
  try {
    // ファイル全体を同期的に読み込む
    const data = fs.readFileSync(filePath, "utf-8");
    const rows = data.split("\n"); // 行単位で分割

    // CSVヘッダーを除外してデータをループ
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].trim().replace(/"/g, ""); // ダブルコーテーションをすべて除去

      if (!row) continue; // 空行をスキップ

      const columns = row.split(",");

      // コラム0が一致する行を探す
      if (columns[searchColumnId] === param) {
        return columns[returnColumnId] || "無効データ";
      }
    }

    return "無効データ"; // 見つからなかった場合
  } catch (error) {
    console.error("エラーが発生しました:", error);
    return "無効データ";
  }
}

function getStopNameByStopId(filePath, stopId) {
  return getColumnById(filePath, stopId, 0, 2);
}

function getRouteShortNameByRouteId(filePath, routeId) {
  return getColumnById(filePath, routeId, 0, 2);
}

function getIconLinkByVehicleLabel(filePath, vehicleLabel) {
  try {
    // ファイル全体を同期的に読み込む
    const data = fs.readFileSync(filePath, "utf-8");
    const rows = data.split("\n"); // 行単位で分割
    let result = "";

    // CSVヘッダーを除外してデータをループ
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].trim().replace(/"/g, ""); // ダブルコーテーションをすべて除去

      if (!row) continue; // 空行をスキップ

      const columns = row.split(",");

      // コラム0が一致する行を探す
      if (columns[0] === vehicleLabel) {
        result = columns[1];
        break;
      }

      // DEFAULT
      if (columns[0] === "DEFAULT") {
        result = columns[1];
        break;
      }
    }

    return result;
  } catch (error) {
    console.error("エラーが発生しました:", error);
    return "";
  }
}

const app = express();

app.use(cors());

app.get("/", async (req, res) => {
  let returnArray = [];
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
        tripUpdate: {
          ...item2.tripUpdate, // 元のtripUpdateを展開
          trip: {
            ...item2.tripUpdate.trip, // tripの中身を展開
            routeShortName: getRouteShortNameByRouteId(
              path.resolve(__dirname, "../data/ryobi", "./routes.txt"),
              item2.tripUpdate.trip.routeId
            ), // routeShortNameを追加
          },
          stopTimeUpdate: item2.tripUpdate.stopTimeUpdate.map((stopTime) => ({
            ...stopTime, // 各stopTimeUpdateを展開
            stopName: getStopNameByStopId(
              path.resolve(__dirname, "../data/ryobi", "./stops.txt"),
              stopTime.stopId
            ), // stopNameを追加
          })),
        },
        icon: getIconLinkByVehicleLabel(
          path.resolve(__dirname, "../data/ryobi", "./vehicle_icon.csv"),
          item1.vehicle.vehicle.label
        ),
        // nextStopName: getStopNameByStopId(
        //   "ryobi/stops.txt",
        //   item2.tripUpdate.stopTimeUpdate[item1.vehicle.currentStopSequence]
        //     .stopId
        // ), // currentStopSequenceが1スタート
      };
    });

    // console.log(JSON.stringify(returnArray, null, 2));
  }
  res.send(returnArray);
});

app.listen(3000, () => console.log("Server ready on port 3000."));

module.exports = app;
