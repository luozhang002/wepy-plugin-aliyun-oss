import path from "path";
import fs from "fs";
import Utils from "./utils/index";
import OssDriver from "./driver/oss";
const validator = require("validator");

export default class CloudStorage {
  constructor(options = {}) {
    this.options = options;

    this.options.config = Object.assign(
      {
        limit: 1024,
        prefix: "cdn-wxapp",
        debugMode: true,
        time: true,
        delDistImg: true
      },
      this.options.config
    );

    this.driver = null;

    this.driver = new OssDriver(this.options);
  }

  apply(op) {
    const { code, file } = op;
    const config = this.options.config;
    const { debugMode, lessRootpath } = config;
    const _this = this;
    if (debugMode) {
      console.log("\nwepy-plugin-image file:", file);
      console.log("lessRootpath", lessRootpath);
    }

    const reg = /\/assets\/\S+(.png|jpeg)/gi;
    if (!code) {
      if (debugMode) {
        console.error("code is null");
      }
      op.next();
    } else {
      const bgPaths = code.match(reg) || [];
      if (debugMode) {
        console.log("wepy-plugin-aliyun-oss bgPaths:\n", bgPaths);
      }

      const base64List = [];
      const uploadList = [];
      // op.next()
      bgPaths.forEach(item => {
        const bgImage = item
          .replace(/'/g, "")
          .replace(/"/g, "")
          .replace("url(", "")
          .replace(/\)$/g, "");
        // 本身是绝对地址
        let bgPath = bgImage;

        // 绝对地址不存在，使用去除lessRootpath地址的相对地址
        if (!fs.existsSync(bgPath)) {
          bgPath = path.join(
            path.dirname(file.replace("dist", "src")),
            bgImage.replace(lessRootpath, "")
          );
        }

        if (!fs.existsSync(bgPath)) {
          bgPath = path.join(process.cwd(), bgImage);
        }

        // less使用e('')传递的路径
        if (!fs.existsSync(bgPath)) {
          bgPath = path.join(
            path.dirname(file.replace("dist", "src")),
            bgImage
          );
        }

        if (!fs.existsSync(bgPath)) {
          bgPath = path.resolve(path.dirname(file), bgPath);
        }

        if (debugMode) {
          console.log("bgPath:", bgPath);
        }

        if (!fs.existsSync(bgPath) && debugMode) {
          console.error("%s不存在", bgPath);
        }
        if (!validator.isURL(bgImage) && fs.existsSync(bgPath)) {
          uploadList.push({
            path: bgPath,
            bg: bgImage
          });
        }
      });

      const promiseUploadList = [];
      uploadList.forEach(uploadfile => {
        promiseUploadList.push(
          new Promise(resolve => {
            _this.driver
              .uploader(uploadfile.bg.replace(/\//g, "_"), uploadfile.path)
              .then(res => {
                const image = uploadfile.bg;
                !_this.options.config.debugMode ||
                  Utils.success(res.original, "上传到CDN响应数据");

                let newUrl = _this.options.config.time
                  ? res.url + "?t=" + new Date().getTime()
                  : res.url;

                Utils.success(image + " ----> " + newUrl, "上传到CDN成功");

                // !_this.options.config.delDistImg ||
                //   fs.unlink(path.join(process.cwd(), "dist", image), err => {
                //     if (_this.options.config.debugMode && err) {
                //       Utils.warn(err, "删除dist图片");
                //     }

                //     err || Utils.success(image, "删除dist图片成功");
                //   });
                resolve({
                  ...uploadfile,
                  uploadUrl: newUrl
                });
              })
              .catch(e => {
                Utils.error(e, "上传到CDN失败");
                resolve({});
              });
          })
        );
      });
      // 无图片的时候
      if (!promiseUploadList.length) {
        if (debugMode) {
          console.log("wepy-plugin-image no upload image");
        }
        op.next();
        return;
      }
      Promise.all(promiseUploadList)
        .then(resultList => {
          resultList.forEach(item => {
            const bgUrl = item.bg;
            const uploadUrl = (item.uploadUrl || "").replace(
              "http://",
              "https://"
            );
            op.code = op.code.replace(new RegExp(bgUrl, "gi"), uploadUrl);
          });
          op.next();
        })
        .catch(e => {
          console.log(e);
        });
    }
  }
}
