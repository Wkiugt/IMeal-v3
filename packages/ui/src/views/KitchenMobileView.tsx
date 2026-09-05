import React from 'react';
import './KitchenMobileView.css';

export const KitchenMobileView: React.FC = () => {
  return (
    <>
      <div className="canvas">
        <div className="device" data-od-id="device-frame">
          <div className="statusbar" data-od-id="status-bar" aria-hidden="true">
            <span>9:41</span>
            <span className="island"></span>
            <span className="icons">
              <svg
                viewBox="0 0 20 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <rect x="1" y="3" width="14" height="8" rx="2" />
                <path d="M17 6v2" strokeLinecap="round" />
                <rect
                  x="3"
                  y="5"
                  width="9"
                  height="4"
                  rx="1"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              <svg
                viewBox="0 0 18 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 5.5a10 10 0 0 1 14 0M4.5 8a6.5 6.5 0 0 1 9 0M7 10.5a3 3 0 0 1 4 0" />
                <circle
                  cx="9"
                  cy="12.5"
                  r="0.8"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </span>
          </div>

          <main className="app-content">
            <section
              className="screen active"
              id="screen-kitchen-dashboard"
              data-od-id="screen-kitchen-dashboard"
            >
              <div className="greet-row" data-od-id="kitchen-greeting">
                <div>
                  <p className="eyebrow">TUESDAY, AUG 25 · KITCHEN</p>
                  <h1 className="greet-name">Today's Prep</h1>
                </div>
                <div className="avatar">KS</div>
              </div>

              <div
                className="card kitchen-total-card"
                data-od-id="total-meals-card"
              >
                <p className="eyebrow">TOTAL MEALS ORDERED TODAY</p>
                <div className="kitchen-total-row">
                  <span className="kitchen-total-num">184</span>
                  <span className="kitchen-total-unit">meals</span>
                </div>
                <div className="kitchen-total-meta">
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10 2.5c-3.6 4-5.5 6.9-5.5 9.5a5.5 5.5 0 0 0 11 0c0-2.6-1.9-5.5-5.5-9.5Z" />
                  </svg>
                  <span>Lunch service · Canteen A, 12:00–13:00</span>
                </div>
              </div>

              <div
                className="card diet-card"
                data-od-id="dietary-breakdown-card"
              >
                <p className="eyebrow">DIETARY PREFERENCES</p>
                <div
                  className="diet-bar"
                  role="img"
                  aria-label="72% Regular, 28% Vegetarian"
                >
                  <div className="diet-seg regular" style={{ flex: 72 }}></div>
                  <div className="diet-seg veg" style={{ flex: 28 }}></div>
                </div>
                <div className="diet-legend">
                  <div className="diet-legend-item">
                    <span className="diet-dot regular"></span>
                    <div className="diet-legend-info">
                      <span className="diet-legend-label">Regular</span>
                      <span className="diet-legend-num">132</span>
                    </div>
                  </div>
                  <div className="diet-legend-item">
                    <span className="diet-dot veg"></span>
                    <div className="diet-legend-info">
                      <span className="diet-legend-label">Vegetarian</span>
                      <span className="diet-legend-num">52</span>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="card checkin-card"
                data-od-id="checkin-progress-card"
              >
                <div className="checkin-head">
                  <p className="eyebrow">CHECK-IN PROGRESS</p>
                  <span className="checkin-ratio">126 / 184</span>
                </div>
                <div
                  className="progress-track"
                  role="img"
                  aria-label="126 of 184 employees checked in, 68%"
                >
                  <div
                    className="progress-fill"
                    style={{ '--progress': 0.68 } as React.CSSProperties}
                  ></div>
                </div>
                <div className="checkin-legend">
                  <span className="checkin-legend-item">
                    <span className="checkin-dot done"></span>Checked-in · 126
                  </span>
                  <span className="checkin-legend-item">
                    <span className="checkin-dot pending"></span>Pending · 58
                  </span>
                </div>
              </div>
            </section>

            <section
              className="screen"
              id="screen-scanner"
              data-od-id="screen-scanner"
            >
              <div className="scanner-wrap">
                <div className="scanner-head" data-od-id="scanner-heading">
                  <h1>Scan Employee Ticket</h1>
                  <p>Align the QR code within the frame to check in</p>
                </div>

                <button
                  className="viewfinder"
                  id="viewfinderBtn"
                  data-od-id="qr-viewfinder"
                  aria-label="Simulate scanning an employee ticket"
                >
                  <span className="vf-bracket tl" aria-hidden="true"></span>
                  <span className="vf-bracket tr" aria-hidden="true"></span>
                  <span className="vf-bracket bl" aria-hidden="true"></span>
                  <span className="vf-bracket br" aria-hidden="true"></span>
                  <span className="vf-scanline" aria-hidden="true"></span>
                  <span className="vf-hint" aria-hidden="true">
                    <span className="vf-hint-primary">Camera preview</span>
                    <span className="vf-hint-secondary">
                      Tap to simulate a scan
                    </span>
                  </span>
                </button>

                <div
                  className="scanned-card"
                  id="scannedCard"
                  data-od-id="last-scanned-card"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <div className="scanned-top">
                    <div className="avatar" id="scannedAvatar">
                      MA
                    </div>
                    <div className="scanned-info">
                      <span className="scanned-label">Last scanned</span>
                      <span className="scanned-name" id="scannedName">
                        Minh Anh
                      </span>
                      <span className="scanned-id" id="scannedId">
                        EMP-04521 · 12:41 PM
                      </span>
                    </div>
                  </div>
                  <span className="pill pill-good" id="scannedStatus">
                    <svg
                      id="scannedStatusIcon"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4.5 10.5 8 14l7.5-7.5" />
                    </svg>
                    <span id="scannedStatusLabel">Check-in Successful</span>
                  </span>
                </div>
              </div>
            </section>
          </main>

          <nav className="bottom-nav" data-od-id="bottom-nav">
            <button
              className="nav-item active"
              data-target="screen-kitchen-dashboard"
              data-od-id="nav-kitchen-dashboard"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 11.5 12 4l8 7.5" />
                <path d="M6 10v8.5a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1V10" />
              </svg>
              <span className="nav-label">Dashboard</span>
            </button>
            <button
              className="nav-item"
              data-target="screen-scanner"
              data-od-id="nav-scanner"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.4" />
                <rect x="14" y="3" width="7" height="7" rx="1.4" />
                <rect x="3" y="14" width="7" height="7" rx="1.4" />
                <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
              </svg>
              <span className="nav-label">Scanner</span>
            </button>
          </nav>
        </div>
      </div>
    </>
  );
};
