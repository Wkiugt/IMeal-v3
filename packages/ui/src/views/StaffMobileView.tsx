import React from 'react';
import './StaffMobileView.css';

export const StaffMobileView: React.FC = () => {
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
              id="screen-login"
              data-od-id="screen-login"
            >
              <div className="login-wrap">
                <div className="login-mark" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 3v9a3 3 0 0 0 6 0V3M9 8.5V3" />
                    <path d="M17.5 3c-1.4 1.4-2 3-2 5.2 0 1.8.9 2.8 2 3.3V21" />
                  </svg>
                </div>
                <h1 className="login-title">Welcome</h1>
                <p className="login-sub">
                  Sign in with your work account to register meals and check in
                  at the canteen.
                </p>
                <button
                  className="ms-login-btn"
                  id="msLoginBtn"
                  data-od-id="ms-login-button"
                >
                  <svg
                    className="ms-logo"
                    viewBox="0 0 21 21"
                    aria-hidden="true"
                  >
                    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                  </svg>
                  <span>Login with Microsoft</span>
                </button>
                <p className="login-footnote">
                  Access is limited to employees with a company Microsoft
                  account.
                </p>
              </div>
            </section>

            <section
              className="screen"
              id="screen-dashboard"
              data-od-id="screen-dashboard"
            >
              <div className="greet-row" data-od-id="greeting">
                <div>
                  <p className="eyebrow">TUESDAY, AUG 25</p>
                  <h1 className="greet-name">Hi, Minh Anh</h1>
                </div>
                <div className="avatar">MA</div>
              </div>

              <div className="card meal-card" data-od-id="today-meal-card">
                <div className="row-top">
                  <span className="pill pill-soft">Lunch · 12:00–13:00</span>
                  <span
                    className="pill pill-soft"
                    id="mealStatusPill"
                    data-od-id="meal-status-pill"
                  >
                    Confirmed
                  </span>
                </div>
                <h2 className="meal-title">Grilled Chicken Rice Bowl</h2>
                <p className="meal-sub">
                  Steamed rice, grilled chicken thigh, stir-fried greens
                </p>
                <hr className="meal-divider" />
                <div className="meal-meta-row">
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
                  <span>Canteen A · Counter 2</span>
                </div>
              </div>

              <button
                className="scan-cta"
                id="scanQrBtn"
                data-od-id="scan-qr-button"
              >
                <span className="scan-icon-wrap">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1.4" />
                    <rect x="14" y="3" width="7" height="7" rx="1.4" />
                    <rect x="3" y="14" width="7" height="7" rx="1.4" />
                    <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
                  </svg>
                </span>
                <span className="scan-copy">
                  <span className="scan-title">Scan QR</span>
                  <span className="scan-sub">Check in at the canteen</span>
                </span>
                <svg
                  className="scan-arrow"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7.5 4.5 13 10l-5.5 5.5" />
                </svg>
              </button>
            </section>

            <section
              className="screen"
              id="screen-calendar"
              data-od-id="screen-calendar"
            >
              <div className="cal-header" data-od-id="calendar-header">
                <h1 className="cal-month" id="calMonthLabel">
                  August 2026
                </h1>
                <div className="cal-nav">
                  <button
                    className="cal-nav-btn"
                    id="calPrev"
                    aria-label="Previous month"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12.5 4.5 7 10l5.5 5.5" />
                    </svg>
                  </button>
                  <button
                    className="cal-nav-btn"
                    id="calNext"
                    aria-label="Next month"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M7.5 4.5 13 10l-5.5 5.5" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="card cal-card" data-od-id="calendar-grid">
                <div className="weekday-row">
                  <span>Mo</span>
                  <span>Tu</span>
                  <span>We</span>
                  <span>Th</span>
                  <span>Fr</span>
                  <span>Sa</span>
                  <span>Su</span>
                </div>
                <div className="day-grid" id="dayGrid"></div>
              </div>

              <div className="cal-legend">
                <span className="cal-legend-item">
                  <span className="cal-legend-swatch booked"></span>Booked
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-swatch today"></span>Today
                </span>
                <span className="cal-legend-item">
                  <span className="cal-legend-swatch avail"></span>Available
                </span>
              </div>

              <div className="week-header" data-od-id="week-header">
                <h2>Weekly Meal Registration</h2>
                <p>Aug 24–28, 2026 · Toggle a day on to register lunch</p>
              </div>

              <div className="week-list" id="weekList" data-od-id="week-list">
                <div className="week-row" data-od-id="week-row-mon">
                  <div className="week-row-info">
                    <span className="week-day">Monday</span>
                    <span className="week-date">Aug 24</span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="true"
                    aria-label="Toggle lunch registration for Monday"
                    data-od-id="week-toggle-mon"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
                <div className="week-row is-today" data-od-id="week-row-tue">
                  <div className="week-row-info">
                    <span className="week-day">
                      Tuesday
                      <span className="pill pill-soft week-today-tag">
                        Today
                      </span>
                    </span>
                    <span className="week-date">Aug 25</span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="true"
                    aria-label="Toggle lunch registration for Tuesday"
                    data-od-id="week-toggle-tue"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
                <div className="week-row" data-od-id="week-row-wed">
                  <div className="week-row-info">
                    <span className="week-day">Wednesday</span>
                    <span className="week-date">Aug 26</span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="false"
                    aria-label="Toggle lunch registration for Wednesday"
                    data-od-id="week-toggle-wed"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
                <div className="week-row" data-od-id="week-row-thu">
                  <div className="week-row-info">
                    <span className="week-day">Thursday</span>
                    <span className="week-date">Aug 27</span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="true"
                    aria-label="Toggle lunch registration for Thursday"
                    data-od-id="week-toggle-thu"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
                <div className="week-row" data-od-id="week-row-fri">
                  <div className="week-row-info">
                    <span className="week-day">Friday</span>
                    <span className="week-date">Aug 28</span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="false"
                    aria-label="Toggle lunch registration for Friday"
                    data-od-id="week-toggle-fri"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
              </div>
            </section>

            <section
              className="screen"
              id="screen-ticket"
              data-od-id="screen-ticket"
            >
              <div className="ticket-wrap">
                <div className="ticket-head" data-od-id="ticket-heading">
                  <h1>Meal Ticket</h1>
                  <p>Show this QR code at the canteen entrance</p>
                </div>

                <div className="ticket-card" data-od-id="ticket-card">
                  <div className="ticket-top">
                    <div className="qr-frame">
                      <div
                        className="qr-grid"
                        id="qrGrid"
                        data-od-id="qr-code"
                      ></div>
                    </div>
                    <p className="ticket-name">Minh Anh</p>
                    <p className="ticket-id">EMP-04521</p>
                  </div>
                  <div className="ticket-perf"></div>
                  <div className="ticket-bottom">
                    <div className="ticket-row">
                      <span className="k">Meal</span>
                      <span className="v">Lunch</span>
                    </div>
                    <div className="ticket-row">
                      <span className="k">Date</span>
                      <span className="v">Tue, Aug 25 2026</span>
                    </div>
                    <div className="ticket-row">
                      <span className="k">Location</span>
                      <span className="v">Canteen A · Counter 2</span>
                    </div>
                    <div className="ticket-note">
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="10" cy="10" r="7.5" />
                        <path d="M10 6.5v4l2.6 1.5" />
                      </svg>
                      <span>Valid until 13:00 today</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section
              className="screen"
              id="screen-profile"
              data-od-id="screen-profile"
            >
              <div className="screen-title" data-od-id="profile-title">
                <h1>Profile</h1>
                <p>Your identity, meal activity, and preferences</p>
              </div>

              <div className="card identity-card" data-od-id="identity-card">
                <div className="avatar avatar-lg">MA</div>
                <div className="identity-info">
                  <h2 className="identity-name">Minh Anh</h2>
                  <span className="pill pill-soft id-pill">EMP-04521</span>
                  <p className="identity-dept">Product Engineering</p>
                </div>
              </div>

              <div className="card stats-card" data-od-id="meal-stats-card">
                <p className="eyebrow">THIS MONTH</p>
                <div className="stats-row">
                  <div className="stat-block">
                    <span className="stat-num">15</span>
                    <span className="stat-label">Meals booked</span>
                  </div>
                  <div className="stat-divider"></div>
                  <div className="stat-block">
                    <span className="stat-num">12</span>
                    <span className="stat-label">Meals enjoyed</span>
                  </div>
                </div>
              </div>

              <div className="card prefs-list" data-od-id="preferences-list">
                <div className="pref-row" data-od-id="pref-dietary">
                  <div className="pref-row-info">
                    <span className="pref-label">Dietary Preferences</span>
                  </div>
                  <span className="tag-chip">Vegetarian</span>
                </div>
                <div className="pref-divider"></div>
                <div className="pref-row" data-od-id="pref-reminders">
                  <div className="pref-row-info">
                    <span className="pref-label">Booking Reminders</span>
                    <span className="pref-sub">
                      Notify before the weekly cutoff
                    </span>
                  </div>
                  <button
                    className="toggle"
                    role="switch"
                    aria-checked="true"
                    aria-label="Toggle booking reminders"
                    data-od-id="reminders-toggle"
                  >
                    <span className="toggle-thumb"></span>
                  </button>
                </div>
              </div>

              <button
                className="logout-btn"
                id="logoutBtn"
                data-od-id="logout-button"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 17.5H4.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1H8" />
                  <path d="M13 14l3.5-4-3.5-4" />
                  <path d="M16.5 10h-9" />
                </svg>
                <span>Log out</span>
              </button>
            </section>
          </main>

          <nav className="bottom-nav hidden" data-od-id="bottom-nav">
            <button
              className="nav-item active"
              data-target="screen-dashboard"
              data-od-id="nav-dashboard"
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
              data-target="screen-calendar"
              data-od-id="nav-calendar"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
                <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
              </svg>
              <span className="nav-label">Calendar</span>
            </button>
            <button
              className="nav-item"
              data-target="screen-ticket"
              data-od-id="nav-ticket"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 9a2 2 0 0 0 0 6v2a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-6V7a1 1 0 0 0-1-1h-15a1 1 0 0 0-1 1Z" />
                <path d="M14.5 6.5v11" strokeDasharray="2 2.4" />
              </svg>
              <span className="nav-label">Ticket</span>
            </button>
            <button
              className="nav-item"
              data-target="screen-profile"
              data-od-id="nav-profile"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
              </svg>
              <span className="nav-label">Profile</span>
            </button>
          </nav>
        </div>
      </div>
    </>
  );
};
