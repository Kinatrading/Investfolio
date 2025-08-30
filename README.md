# Steam Invest Ultra (UAH)

**Що всередині:**

- **Пер-товарні алерти прямо в портфелі:** поля *Alert Buy ≤* (листинг) та *Alert Sell (нетто buy-order) ≥*.
- **Auto-refresh fixed:** фоновий `chrome.alarms` працює після рестарту браузера (`onStartup`), `batchScan` реально біжить.
- **Єдиний формат даних — JSON:** кнопки «Експорт JSON» та «Імпорт JSON».
- **Unrealized PnL у шапці** — підтягується зі зведення портфеля.
- **Break-even та ROI-калькулятор** для обраної позиції.
- **Глибина ринку (Top-5)** з `sell_order_table` і `buy_order_table`.
- **Волатильність (σ)** — std dev останніх 30 значень.
- **Спарклайн ціни** для обраної позиції.
- **Теги, пошук, dark mode, хоткеї.**

Встановлення: `chrome://extensions` → Developer mode → Load unpacked.
