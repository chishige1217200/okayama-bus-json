const express = require("express");
const cors = require("cors");
const axios = require("axios");
const protobuf = require("protobufjs");
const fs = require("fs");
const path = require("path");

// gtfs-realtime.protoを読込
const loadProto = () =>
  protobuf.load(path.resolve(__dirname, "../data/", "./gtfs-realtime.proto"));

const ryobi_routes_data = fs.readFileSync(
  path.resolve(__dirname, "../data/ryobi", "./routes.txt"),
  "utf-8"
);

const ryobi_routesjp_data = fs.readFileSync(
  path.resolve(__dirname, "../data/ryobi", "./routes_jp.txt"),
  "utf-8"
);

const ryobi_stops_data = fs.readFileSync(
  path.resolve(__dirname, "../data/ryobi", "./stops.txt"),
  "utf-8"
);

const ryobi_icon_data = fs.readFileSync(
  path.resolve(__dirname, "../data/ryobi", "./vehicle_icon.csv"),
  "utf-8"
);

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
 * @param {string} data - CSVデータ
 * @param {string} param - 検索する値
 * @param {number} searchColumnId - 検索するコラム列番号
 * @param {number} returnColumnId - 返却するコラム列番号
 * @returns {string} - コラムの値または"無効データ"
 */
function getColumnById(data, param, searchColumnId, returnColumnId) {
  try {
    const rows = data
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean); // 空行を除外

    // 通常行（ヘッダー除く）を走査
    for (let i = 1; i < rows.length; i++) {
      const columns = rows[i].split(",");
      // コラムが一致する行を探す
      if (columns[searchColumnId] === `"${param}"`) {
        return columns[returnColumnId].replace(/"/g, "") ?? "無効データ"; // ダブルコーテーションは除去
      }
    }

    return "無効データ"; // 見つからなかった場合
  } catch (error) {
    console.error("エラーが発生しました:", error);
    return "無効データ";
  }
}

function getStopNameByStopId(data, stopId) {
  return getColumnById(data, stopId, 0, 2);
}

function getRouteShortNameByRouteId(data, routeId) {
  return getColumnById(data, routeId, 0, 2);
}

function getDestinationStopNameByRouteId(data, routeId) {
  return getColumnById(data, routeId, 0, 4);
}

function getIconLinkByVehicleLabel(data, vehicleLabel) {
  try {
    const rows = data
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean); // 空行を除外

    // 通常行（ヘッダー除く・最終行除く）を走査
    for (let i = 1; i < rows.length - 1; i++) {
      const columns = rows[i].split(",");
      // コラム0が一致する行を探す
      if (columns[0] === `"${vehicleLabel}"`) {
        return columns[1].replace(/"/g, ""); // ダブルコーテーションは除去
      }
    }

    // 一致しなかった場合は DEFAULT（最後の有効行）を返す
    const defaultRow = rows[rows.length - 1];
    const defaultColumns = defaultRow.split(",");
    return defaultColumns[1].replace(/"/g, "") ?? ""; // ダブルコーテーションは除去
  } catch (error) {
    console.error("エラーが発生しました:", error);
    return "";
  }
}

const app = express();

app.use(cors());

app.get("/", async (req, res) => {
  // const start = performance.now();
  // console.log("処理開始");

  let returnArray = [];
  const [ryobiArray, ryobiArray2] = await Promise.all([
    parseData("https://loc.bus-vision.jp/realtime/ryobi_vpos_update.bin"),
    parseData("https://loc.bus-vision.jp/realtime/ryobi_trip_update.bin"),
  ]);
  //   const ryobiArray = await parseData("./ryobi_vpos_update.bin", true);
  //   const ryobiArray2 = await parseData("./ryobi_trip_update.bin", true);

  // const connectEnd = performance.now();
  // console.log(`通信終了まで: ${(connectEnd - start).toFixed(2)} ミリ秒`);

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
              ryobi_routes_data,
              item2.tripUpdate.trip.routeId
            ), // routeShortNameを追加
            destinationStopName: getDestinationStopNameByRouteId(
              ryobi_routesjp_data,
              item2.tripUpdate.trip.routeId
            ), // destinationStopNameを追加
          },
          stopTimeUpdate: item2.tripUpdate.stopTimeUpdate.map((stopTime) => ({
            ...stopTime, // 各stopTimeUpdateを展開
            stopName: getStopNameByStopId(ryobi_stops_data, stopTime.stopId), // stopNameを追加
          })),
        },
        icon: getIconLinkByVehicleLabel(
          ryobi_icon_data,
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

  // const processEnd = performance.now();
  // console.log(`処理終了まで: ${(processEnd - connectEnd).toFixed(2)} ミリ秒`);

  res.send(returnArray);
});

app.listen(3000, () => console.log("Server ready on port 3000."));

module.exports = app;
