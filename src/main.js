const { app, BrowserWindow, shell, Tray, Menu, ipcMain } = require("electron");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { print } = require("pdf-to-printer");

// Keep global references
let mainWindow;
let tray;
let printLogs = [];

// Check if app is already running (prevent multiple instances)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  // Create window for the print server status
  mainWindow = new BrowserWindow({
    // fullscreen: true,
    frame: true,
    autoHideMenuBar: true, // hide the menu bar until Alt is pressed
    minimizable: true,
    maximizable: true,
    closable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    show: true, // Initially hidden
    icon: path.join(__dirname, "../icon.png"),
  });

  // Load the local status page
  // mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Open the user's POS system in their default browser in full screen
  // shell.openExternal("https://respos.zigma99.com/");

  // Load the POS website right in Electron
  mainWindow.loadURL("https://respos.zigma99.com/");

  // Once it's ready, maximize and show it
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Create the tray icon
  createTray();
}

function createTray() {
  // Use the app icon for the tray
  const iconPath = path.join(__dirname, "../icon.png");
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Print Server Status",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Open POS System",
      click: () => {
        shell.openExternal("https://respos.zigma99.com/");
      },
    },
    { type: "separator" },
    {
      label: "Auto-start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: () => {
        const settings = app.getLoginItemSettings();
        app.setLoginItemSettings({
          openAtLogin: !settings.openAtLogin,
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("ZigmaPOS Print Server");
  tray.setContextMenu(contextMenu);

  // Show window on tray icon double-click
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function startExpressServer() {
  // Start Express
  const server = express();
  server.use(cors());
  server.use(express.json({ limit: "200mb" }));

  // Get available printers endpoint
  server.get("/printers", async (req, res) => {
    try {
      // This would require an additional module like printer or node-printer
      // For now, we'll just respond with a success message
      res.json({ success: true, message: "Printer list would appear here" });
    } catch (err) {
      console.error("Error getting printers:", err);
      res.status(500).send(err.message);
    }
  });

  server.post("/print", async (req, res) => {
    try {
      const { pdf_base64, printer_name } = req.body;
      if (!pdf_base64 || !printer_name) {
        logPrintJob(`❌ Error: Missing pdf_base64 or printer_name`);
        return res.status(400).send("Missing pdf_base64 or printer_name");
      }

      logPrintJob(`📄 Received print job for printer: ${printer_name}`);

      // Decode & save PDF
      const pdfBuffer = Buffer.from(pdf_base64, "base64");
      const tempPath = path.join(app.getPath("temp"), `pos-${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, pdfBuffer);

      logPrintJob(`💾 PDF saved temporarily: ${path.basename(tempPath)}`);

      // Print silently
      await print(tempPath, { printer: printer_name });

      // Clean up & respond
      fs.unlinkSync(tempPath);
      logPrintJob(`✅ Successfully printed to: ${printer_name}`);
      res.sendStatus(200);
    } catch (err) {
      logPrintJob(`❌ Print error: ${err.message}`);
      console.error("Print error:", err);
      res.status(500).send(err.message);
    }
  });

  // Health check endpoint
  server.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Start server
  server.listen(8191, () => {
    const message = "🖨️ Print server listening on http://localhost:8191";
    console.log(message);
    logPrintJob(message);
  });
}

// Function to log print jobs and update UI
function logPrintJob(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = `[${timestamp}] ${message}`;

  printLogs.push(logEntry);
  // Keep only the last 100 logs
  if (printLogs.length > 100) {
    printLogs.shift();
  }

  // Send to UI if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents
      .executeJavaScript(
        `
      (function() {
        const logDiv = document.querySelector('.print-log');
        if (logDiv) {
          const newEntry = document.createElement('div');
          newEntry.textContent = '${logEntry.replace(/'/g, "\\'")}';
          logDiv.appendChild(newEntry);
          logDiv.scrollTop = logDiv.scrollHeight;
        }
        return true;
      })()
    `
      )
      .catch((err) => console.error("Error updating UI logs:", err));
  }
}

// Setup IPC handlers for the UI
function setupIPC() {
  ipcMain.on("get-logs", (event) => {
    event.returnValue = printLogs;
  });
}

app.on("ready", () => {
  createWindow();
  startExpressServer();
  setupIPC();

  // Set app to open at login
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
});

// Don't quit when windows are closed (stay in tray)
app.on("window-all-closed", function () {
  // Do nothing to keep app running in background
});

app.on("activate", function () {
  if (mainWindow === null) createWindow();
});

// Quit properly when asked to
app.on("quit", () => {
  if (tray) {
    tray.destroy();
  }
});
