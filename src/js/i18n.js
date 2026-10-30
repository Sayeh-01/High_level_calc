/*
 * High Level Calc — translations (English / Arabic) and locale-aware
 * number, money and date formatting. UMD: window.HLI18n or require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const en = {
    appName: 'High Level Calc',
    tagline: 'Accounts for every client and job',
    allJobs: 'All clients & jobs',
    newJob: 'New client / job',
    switchLang: 'العربية',
    theme: 'Theme', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'Match system',
    appSettings: 'App settings',
    backup: 'Back up all data', restore: 'Restore from backup',
    exportExcel: 'Export to Excel', exportPdf: 'Save as PDF', print: 'Print',
    saved: 'All changes saved', saveFailed: 'Could not save — your last change is kept in memory. Check disk space.',
    closeTab: 'Close tab (the job stays saved)',
    renameHint: 'Double-click to rename',
    undo: 'Undo', cancel: 'Cancel', save: 'Save', add: 'Add', edit: 'Edit', del: 'Delete', duplicate: 'Duplicate', open: 'Open', close: 'Close', create: 'Create', apply: 'Apply',
    yes: 'Yes', no: 'No', none: '— None —', all: 'All', search: 'Search', actions: 'Actions', total: 'Total', totals: 'Totals', notes: 'Notes', name: 'Name', date: 'Date', amount: 'Amount', status: 'Status', from: 'From', to: 'To', optional: 'optional',
    confirmDelete: 'Delete “{name}”? This cannot be reversed except with Undo right after.',
    deleted: '“{name}” deleted', duplicated: 'Copy created', restored: 'Restored',
    copySuffix: '(copy)',
    required: 'Fill in this field',
    invalidNumber: 'Enter a number',

    // home
    homeTitle: 'Clients & jobs',
    homeIntro: 'Each client or job opens in its own tab with its own ledger, partners, taxes and reports.',
    homeEmpty: 'No clients or jobs yet. Create one to start, or open the sample job to explore every calculation.',
    createJob: 'Create client / job', openSample: 'Open sample job',
    sampleName: 'Sample — Al Noor Villas', sampleClient: 'Al Noor Real Estate',
    colClient: 'Client', colCurrency: 'Currency', colNetProfit: 'Net profit', colUpdated: 'Last updated', colTab: 'Tab',
    tabOpen: 'Open', tabClosed: 'Closed',
    searchJobs: 'Search by name or client',
    noMatches: 'Nothing matches “{q}”.',

    // new job form
    jobName: 'Client / job name', jobNamePh: 'e.g. Villa renovation — Mr. Ahmed',
    clientName: 'Client name', currency: 'Currency', color: 'Tab color',
    jobPeriod: 'Accounting period', periodThisYear: 'This year', periodLastYear: 'Last year', periodAll: 'All dates', periodCustom: 'Custom dates',

    // job navigation
    nav_overview: 'Overview', nav_ledger: 'Income & expenses', nav_sections: 'Sections', nav_partners: 'Partners & shares',
    nav_assets: 'Assets & depreciation', nav_loans: 'Loans', nav_tax: 'VAT, tax & zakat', nav_analysis: 'Analysis',
    nav_calculators: 'Calculators', nav_report: 'Report', nav_settings: 'Job settings',
    periodLabel: 'Period', allDates: 'All dates', entries: '{n} entries',

    // kinds
    kind_revenue: 'Sales / revenue', kind_returns: 'Sales returns & discounts', kind_cogs: 'Direct cost (cost of sales)',
    kind_opex: 'Operating expense', kind_otherIncome: 'Other income', kind_otherExpense: 'Other expense',
    kindShort_revenue: 'Revenue', kindShort_returns: 'Returns', kindShort_cogs: 'Direct cost', kindShort_opex: 'Expense', kindShort_otherIncome: 'Other income', kindShort_otherExpense: 'Other expense',

    // overview
    kpiNetRevenue: 'Net revenue', kpiTotalCosts: 'Total costs', kpiNetProfit: 'Net profit', kpiNetLoss: 'Net loss', kpiNetMargin: 'Net margin',
    kpiGrossProfit: 'Gross profit', kpiVatDue: 'VAT due', kpiVatRefund: 'VAT refundable', kpiReceivables: 'Owed by customers', kpiPayables: 'Owed to suppliers', kpiCash: 'Cash (estimated)',
    chartTitle: 'Income and expenses by {g}', g_month: 'month', g_quarter: 'quarter', g_year: 'year',
    seriesIncome: 'Income', seriesExpenses: 'Expenses', seriesResult: 'Result',
    chartUndated: '{n} undated entries are counted in the totals but not in the chart.',
    showTable: 'Show as table', showChart: 'Show as chart',
    topExpenses: 'Where the money goes', topIncome: 'Where the money comes from', uncategorized: 'Uncategorized',
    sharesSummary: 'Partners’ shares of the profit', noPartnersYet: 'No partners yet — add them in Partners & shares to split the profit.',
    sectionsSummary: 'Profit by section',
    overviewEmpty: 'This job has no entries yet. Add income and expenses to see profit, taxes and shares.',
    addFirstEntry: 'Add the first entry',

    // P&L lines
    pl_title: 'Profit and loss statement',
    pl_revenue: 'Sales / revenue', pl_returns: 'Less: returns & discounts', pl_netRevenue: 'Net revenue', pl_cogs: 'Less: cost of sales (direct costs)',
    pl_grossProfit: 'Gross profit', pl_opex: 'Less: operating expenses', pl_ebitda: 'Profit before depreciation, interest & tax (EBITDA)',
    pl_depreciation: 'Less: depreciation', pl_operatingProfit: 'Operating profit', pl_otherIncome: 'Add: other income', pl_otherExpense: 'Less: other expenses',
    pl_financeCosts: 'Less: loan interest (finance costs)', pl_pbt: 'Profit before tax', pl_incomeTax: 'Less: income tax', pl_zakat: 'Less: zakat',
    pl_netProfit: 'Net profit', pl_netLoss: 'Net loss', pl_ofRevenue: '% of revenue',

    // ledger
    addIncome: 'Add income', addExpense: 'Add expense', addEntry: 'Add entry', editEntry: 'Edit entry',
    filterKind: 'Type', filterSection: 'Section', filterStatus: 'Payment', onlyPeriod: 'Only this period',
    status_paid: 'Paid', status_partial: 'Partly paid', status_unpaid: 'Unpaid',
    colType: 'Type', colSection: 'Section', colCategory: 'Category', colDescription: 'Description', colParty: 'Customer / supplier',
    colNet: 'Net', colVat: 'VAT', colGross: 'Total', colPaid: 'Paid', colBalance: 'Outstanding',
    outsidePeriod: 'Outside period',
    ledgerEmpty: 'No entries yet. Add income or an expense and every total updates.',
    ledgerNoMatch: 'No entries match these filters.',
    showMore: 'Show {n} more',
    f_kind: 'Type of entry', f_date: 'Date', f_section: 'Section', f_category: 'Category', f_description: 'Description',
    f_party: 'Customer / supplier', f_qty: 'Quantity', f_unitPrice: 'Unit price', f_amount: 'Amount',
    f_amountHelpNet: 'Before VAT', f_amountHelpGross: 'Including VAT', f_amountAuto: 'Quantity × unit price',
    f_vat: 'Subject to VAT', f_vatRate: 'VAT rate %', f_vatRatePh: 'Job rate ({r}%)', f_status: 'Payment status', f_paid: 'Amount paid so far', f_ref: 'Invoice / reference no.', f_notes: 'Notes',
    previewNet: 'Net', previewVat: 'VAT', previewGross: 'Total',

    // sections
    sectionsIntro: 'Split this job into parts — sites, branches, products or phases — and see each part’s own profit.',
    addSection: 'Add section', editSection: 'Edit section', sectionName: 'Section name', sectionNamePh: 'e.g. Building A, Branch 2, Phase 1',
    sectionsEmpty: 'No sections yet. Everything is counted for the job as a whole.',
    unassigned: 'Not assigned (shared)',
    col_netRevenue: 'Net revenue', col_cogs: 'Direct costs', col_grossProfit: 'Gross profit', col_opex: 'Operating exp.', col_other: 'Other (+/−)',
    col_depreciation: 'Depreciation', col_profit: 'Profit', col_margin: 'Margin', col_revShare: 'Share of revenue', col_allocated: 'Shared costs allocated', col_profitAfter: 'Profit after allocation',
    allocateShared: 'Spread shared (unassigned) costs over sections by their share of revenue',
    sectionsNote: 'Section profit is before loan interest, income tax and zakat, which belong to the job as a whole.',
    sectionDeleteNote: 'Entries in “{name}” will become unassigned.',

    // partners
    partnersIntro: 'Net profit is shared in this order: reserves → partner salaries → interest on capital → management shares → the rest by each partner’s ratio.',
    shareMethod: 'Share the remaining profit by', method_manual: 'Agreed percentages', method_capital: 'Capital contributed', method_shares: 'Number of shares', method_weighted: 'Capital × time in the period',
    interestOnCapital: 'Interest on capital (% per year)', legalReserve: 'Legal reserve (% of net profit)', otherReserve: 'Other reserves / retained (% of net profit)',
    addPartner: 'Add partner', editPartner: 'Edit partner', partnersEmpty: 'No partners yet. Add each partner with their capital and share.',
    p_name: 'Partner name', p_capital: 'Capital', p_joinDate: 'Capital paid on', p_joinHelp: 'Leave empty if they were in from the start', p_sharePct: 'Profit share %', p_shares: 'Number of shares',
    p_salary: 'Salary for the period', p_salaryHelp: 'Paid out of profit before the split', p_bonusPct: 'Management share %', p_bonusHelp: 'Taken off the top for running the work', p_drawings: 'Drawings (already withdrawn)',
    d_title: 'How the profit is shared', d_netProfit: 'Net profit for the period', d_legalReserve: 'Less: legal reserve', d_otherReserve: 'Less: other reserves',
    d_salaries: 'Less: partner salaries', d_interest: 'Less: interest on capital', d_bonuses: 'Less: management shares', d_distributable: 'Profit to share by ratio', d_lossToShare: 'Loss to share by ratio',
    r_ratio: 'Ratio', r_salary: 'Salary', r_interest: 'Interest', r_bonus: 'Mgmt share', r_residual: 'Share of rest', r_total: 'Total share', r_drawings: 'Drawings', r_due: 'Due to partner', r_owes: 'Partner owes', r_closing: 'Closing capital',
    unallocatedProfit: 'Not allocated to anyone', profitPerShare: 'Profit per share',
    warnSharesNot100: 'The agreed percentages add up to {total}%, not 100%. The difference stays unallocated.',
    warnNoBasis: 'Enter capital or number of shares for the partners — the chosen method has nothing to divide by.',
    warnBonusOver100: 'Management shares add up to {total}% of the profit.',

    // assets
    assetsIntro: 'Fixed assets lose value over their useful life. The depreciation for this period is charged to the profit automatically.',
    addAsset: 'Add asset', editAsset: 'Edit asset', assetsEmpty: 'No assets yet. Add equipment, vehicles or furniture used in this job.',
    a_name: 'Asset', a_cost: 'Cost', a_salvage: 'Salvage value', a_life: 'Useful life (years)', a_method: 'Method', a_start: 'In use from', a_section: 'Section',
    a_periodDep: 'Depreciation this period', a_accumulated: 'Accumulated', a_bookValue: 'Book value',
    method_sl: 'Straight line', method_ddb: 'Double declining balance', method_syd: 'Sum of the years’ digits', method_none: 'Not depreciated (e.g. land)',
    scheduleTitle: 'Depreciation schedule — {name}', s_year: 'Year', s_starts: 'Starts', s_dep: 'Depreciation', s_acc: 'Accumulated', s_bv: 'Book value',
    showSchedule: 'Schedule', hideSchedule: 'Hide schedule',

    // loans
    loansIntro: 'Loan installments are scheduled monthly. Interest due within the period is charged to the profit automatically.',
    addLoan: 'Add loan', editLoan: 'Edit loan', loansEmpty: 'No loans yet.',
    l_name: 'Loan / lender', l_principal: 'Amount borrowed', l_rate: 'Annual interest %', l_months: 'Term (months)', l_type: 'Repayment', l_start: 'Received on',
    l_payment: 'Installment', l_totalInterest: 'Total interest', l_periodInterest: 'Interest this period', l_balance: 'Balance at period end',
    loan_annuity: 'Equal installments', loan_equal: 'Equal principal', loan_bullet: 'Interest only, principal at end',
    amortTitle: 'Repayment schedule — {name}', am_no: '#', am_due: 'Due', am_payment: 'Installment', am_interest: 'Interest', am_principal: 'Principal', am_balance: 'Balance',

    // tax
    vatTitle: 'Value added tax (VAT)', vatEnabled: 'This job charges / pays VAT', vatRate: 'Standard VAT rate %', vatInclusive: 'Amounts are entered including VAT', vatPaidToAuthority: 'VAT already paid to the tax authority',
    vatSalesBase: 'Taxable sales (net)', vatOutput: 'VAT on sales (output)', vatOutputReturns: 'Less: VAT on returns', vatInput: 'Less: VAT on purchases (input)', vatNet: 'Net VAT for the period', vatPaid: 'Less: already paid', vatBalanceDue: 'VAT still to pay', vatBalanceRefund: 'VAT refundable / carried forward',
    taxTitle: 'Income tax', taxMode: 'How income tax is calculated', tax_none: 'No income tax', tax_flat: 'Flat rate', tax_brackets: 'Brackets (progressive)',
    taxFlatRate: 'Tax rate %', taxBrackets: 'Tax brackets', bracketUpTo: 'Profit up to', bracketRate: 'Rate %', bracketRest: 'and above', addBracket: 'Add bracket',
    taxPresets: 'Presets', preset_eg: 'Egypt companies 22.5%', preset_sa: 'KSA 20%', preset_ae: 'UAE 9% above 375,000', preset_none: 'None',
    taxableProfit: 'Taxable profit', taxAmount: 'Income tax', effectiveRate: 'Effective rate',
    zakatTitle: 'Zakat', zakatMode: 'Zakat base', zakat_none: 'No zakat', zakat_profit: 'Net profit after tax', zakat_netAssets: 'Net current assets', zakat_manual: 'Amount I enter',
    zakatRate: 'Zakat rate %', zakatRateHijri: '2.5% (Hijri year)', zakatRateGregorian: '2.5775% (Gregorian year)', zakatNisab: 'Nisab (minimum)', zakatManualBase: 'Zakat base',
    zakatBase: 'Zakat base', zakatAmount: 'Zakat due', zakatBelowNisab: 'Below the nisab — no zakat due.',
    zakatNetAssetsHelp: 'Cash + customer balances + inventory + other current assets − supplier balances − VAT due − other short-term liabilities − loan installments due within a year. Edit these in Analysis → Financial position.',
    taxDisclaimer: 'Estimates for planning. Rules differ by country and change — confirm the final figures with your tax advisor.',

    // analysis
    ratiosTitle: 'Key ratios', positionTitle: 'Financial position at period end', cashTitle: 'Cash flow (estimated)', breakEvenTitle: 'Break-even', partiesTitle: 'Balances by customer and supplier',
    ratio_grossMargin: 'Gross margin', ratio_ebitdaMargin: 'EBITDA margin', ratio_operatingMargin: 'Operating margin', ratio_netMargin: 'Net margin', ratio_costRatio: 'Costs per 1 of income', ratio_opexRatio: 'Operating expenses / revenue',
    ratio_returnOnCapital: 'Return on partners’ capital', ratio_roe: 'Return on equity', ratio_roa: 'Return on assets', ratio_currentRatio: 'Current ratio', ratio_quickRatio: 'Quick ratio', ratio_debtToEquity: 'Liabilities to equity',
    ratio_workingCapital: 'Working capital', ratio_collectionRate: 'Collected from customers', ratio_receivableDays: 'Days to collect', ratio_payableDays: 'Days to pay suppliers', ratio_interestCover: 'Interest cover',
    ratioHelp_currentRatio: 'Current assets ÷ current liabilities. Above 1 means short-term debts are covered.',
    ratioHelp_quickRatio: 'Like the current ratio, without inventory.',
    ratioHelp_interestCover: 'Operating profit ÷ loan interest.',
    ratioHelp_costRatio: 'Every 1 of income costs this much.',
    times: '{x}×', days: '{x} days', notAvailable: '—',
    pos_cash: 'Cash and bank', pos_receivables: 'Customer balances (receivables)', pos_inventory: 'Inventory', pos_otherCurrentAssets: 'Other current assets', pos_vatCredit: 'VAT refundable', pos_currentAssets: 'Current assets',
    pos_fixedAssets: 'Fixed assets (book value)', pos_totalAssets: 'Total assets', pos_payables: 'Supplier balances (payables)', pos_vatPayable: 'VAT payable', pos_taxPayable: 'Income tax payable', pos_zakatPayable: 'Zakat payable',
    pos_otherCurrentLiabilities: 'Other short-term liabilities', pos_loanCurrent: 'Loan installments due within a year', pos_currentLiabilities: 'Current liabilities', pos_loanNonCurrent: 'Long-term loans', pos_totalLiabilities: 'Total liabilities', pos_equity: 'Net assets (owners’ equity)',
    pos_inputs: 'Figures you enter', pos_openingCash: 'Cash at the start of the period', pos_cashOverride: 'Actual cash at period end', pos_cashOverrideHelp: 'Leave empty to use the estimate from the cash flow',
    cash_opening: 'Cash at the start', cash_collections: 'Collected from customers', cash_refunds: 'Refunds to customers', cash_payments: 'Paid to suppliers and expenses', cash_vatPaid: 'VAT paid to the authority', cash_operating: 'Cash from operations',
    cash_assetPurchases: 'Assets bought', cash_investing: 'Cash used in investing', cash_capitalIn: 'Capital paid in by partners', cash_loansIn: 'Loans received', cash_loanPayments: 'Loan installments paid', cash_drawings: 'Partner drawings', cash_financing: 'Cash from financing', cash_netChange: 'Net change in cash', cash_closing: 'Cash at the end (estimated)',
    be_fromLedger: 'From this job’s figures', be_fromLedgerHelp: 'Direct costs are treated as variable, all other costs as fixed.', be_fixed: 'Fixed costs', be_variableRatio: 'Variable cost ratio', be_contributionRatio: 'Contribution margin ratio', be_revenue: 'Break-even revenue', be_mos: 'Margin of safety', be_impossible: 'Direct costs eat all revenue — there is no break-even point.',
    be_manual: 'Per unit', be_price: 'Selling price per unit', be_vc: 'Variable cost per unit', be_units: 'Expected units sold', be_target: 'Target profit',
    be_cm: 'Contribution per unit', be_beUnits: 'Break-even units', be_beRevenue: 'Break-even sales', be_targetUnits: 'Units for target profit', be_targetRevenue: 'Sales for target profit', be_expectedProfit: 'Expected profit', be_mosUnits: 'Margin of safety (units)', be_dol: 'Operating leverage',
    be_invalid: 'The selling price must be higher than the variable cost per unit.',
    party_name: 'Name', party_sales: 'Sales', party_purchases: 'Purchases', party_receivable: 'They owe us', party_payable: 'We owe them', partiesEmpty: 'Add customer or supplier names to entries to see balances here.',

    // calculators
    calcIntro: 'Quick tools for one-off sums. They don’t change this job’s figures.',
    c_percent: 'Percentages', c_pctOf: '% of a number', c_whatPct: 'What % is A of B', c_change: '% change from A to B', c_pct: 'Percent', c_number: 'Number', c_a: 'A', c_b: 'B',
    c_vat: 'Add or remove VAT', c_net: 'Amount before VAT', c_gross: 'Amount including VAT', c_rate: 'Rate %', c_vatAmount: 'VAT', c_vatOnNet: 'VAT on the amount before VAT', c_grossFromNet: 'Total including VAT', c_vatInGross: 'VAT inside the amount including VAT', c_netFromGross: 'Amount before VAT',
    c_pricing: 'Pricing, margin & markup', c_cost: 'Cost', c_price: 'Selling price', c_markup: 'Markup %', c_margin: 'Margin %', c_profit: 'Profit', c_priceAtMarkup: 'Price at this markup', c_priceAtMargin: 'Price for this margin', c_discountPct: 'Discount %', c_discount: 'Discount', c_afterDiscount: 'Price after discount',
    c_loan: 'Loan installment', c_principal: 'Loan amount', c_annualRate: 'Annual interest %', c_months: 'Months', c_payment: 'Monthly installment', c_totalInterest: 'Total interest', c_totalPaid: 'Total repaid',
    c_simple: 'Simple interest', c_years: 'Years', c_interest: 'Interest', c_totalAmount: 'Total',
    c_compound: 'Savings & compound growth', c_pv: 'Starting amount', c_perYear: 'Compounding per year', c_contribution: 'Added each period', c_fv: 'Future value', c_invested: 'Total put in', c_gain: 'Growth',
    c_investment: 'Investment appraisal (NPV / IRR)', c_discountRate: 'Discount rate %', c_initial: 'Initial investment', c_flows: 'Cash flows per year', c_flowsHelp: 'Separate with commas or spaces, e.g. 3000, 4000, 5000',
    c_npv: 'Net present value', c_irr: 'Internal rate of return', c_payback: 'Payback period', c_dpayback: 'Discounted payback', c_pi: 'Profitability index', c_years_x: '{x} years', c_never: 'Not recovered',
    c_roi: 'Return on investment', c_amountInvested: 'Amount invested', c_finalValue: 'Value now / received', c_roiPct: 'ROI', c_cagr: 'Yearly growth (CAGR)',
    c_currency: 'Currency conversion', c_rateEx: 'Exchange rate (1 unit =)', c_result: 'Result',

    // report
    reportTitle: 'Financial report', reportFor: 'Prepared for', reportPeriod: 'Period', reportGenerated: 'Prepared on', reportCurrency: 'Currency', reportPrintHint: 'This page prints on A4. Use Save as PDF to keep a copy.',

    // settings
    jobDetails: 'Client and job details', c_phone: 'Phone', c_email: 'Email', c_address: 'Address', c_taxId: 'Tax registration no.', jobNotes: 'Notes about this job',
    periodHelp: 'Entries dated outside the period are kept but not counted. Leave both dates empty to count everything.',
    calcOptions: 'Automatic charges', autoDepreciation: 'Charge asset depreciation to the profit', autoLoanInterest: 'Charge loan interest to the profit',
    dangerZone: 'Delete this job', deleteJob: 'Delete job permanently', deleteJobHelp: 'Removes the job and all its entries. You can undo right after.',
    language: 'Language', digits: 'Digits', digitsLatn: '0123456789', digitsArab: '٠١٢٣٤٥٦٧٨٩', defaultCurrency: 'Currency for new jobs', dataFile: 'Data file', openDataFolder: 'Show data folder',
    backupDone: 'Backup saved', restoreDone: 'Data restored from backup', restoreConfirm: 'Replace all current data with the backup? Current data is kept in memory until you close the app, so Undo works right after.', restoreBad: 'That file is not a High Level Calc backup.',
    excelDone: 'Excel file saved', pdfDone: 'PDF saved', exportFailed: 'Export failed: {msg}',
    browserMode: 'Running in a browser preview — data is kept in this browser only.',

    // misc
    period_from_to: '{from} – {to}',
    loss: 'Loss', profit: 'Profit',
    perShare: 'per share',
    upToDate: 'Up to date',

    // Excel export
    xl_settings: 'Settings', xl_transactions: 'Transactions', xl_pl: 'Profit & loss', xl_partners: 'Partners', xl_sections: 'Sections', xl_assets: 'Assets', xl_loans: 'Loans', xl_vat: 'VAT', xl_cash: 'Cash & position',
    xl_code: 'Code', xl_inPeriod: 'In period', xl_days: 'Days in period', xl_lower: 'From', xl_upper: 'Up to', xl_rateStep: 'Rate step', xl_basis: 'Basis', xl_afterReserves: 'Profit after reserves', xl_opening: 'Opening balance', xl_closing: 'Closing balance',
    xl_legend: 'Blue figures are inputs you can change. Black cells are formulas. Green cells are linked from another sheet.',
    xl_appValues: 'Grey-labelled figures are calculated by High Level Calc for the period (prorated by day) and saved as values.',
    xl_netNote: 'Amounts are before VAT.', xl_unbounded: 'Leave “Up to” empty for the top bracket.'
  };

  const ar = {
    appName: 'High Level Calc',
    tagline: 'حسابات كل عميل وكل عملية',
    allJobs: 'كل العملاء والعمليات',
    newJob: 'عميل / عملية جديدة',
    switchLang: 'English',
    theme: 'المظهر', themeLight: 'فاتح', themeDark: 'داكن', themeSystem: 'حسب النظام',
    appSettings: 'إعدادات البرنامج',
    backup: 'نسخ احتياطي لكل البيانات', restore: 'استعادة من نسخة احتياطية',
    exportExcel: 'تصدير إلى Excel', exportPdf: 'حفظ PDF', print: 'طباعة',
    saved: 'تم حفظ كل التغييرات', saveFailed: 'تعذّر الحفظ — آخر تعديل محفوظ في الذاكرة. تأكد من المساحة على القرص.',
    closeTab: 'إغلاق التبويب (تبقى البيانات محفوظة)',
    renameHint: 'انقر مرتين لتغيير الاسم',
    undo: 'تراجع', cancel: 'إلغاء', save: 'حفظ', add: 'إضافة', edit: 'تعديل', del: 'حذف', duplicate: 'نسخ', open: 'فتح', close: 'إغلاق', create: 'إنشاء', apply: 'تطبيق',
    yes: 'نعم', no: 'لا', none: '— بدون —', all: 'الكل', search: 'بحث', actions: 'إجراءات', total: 'الإجمالي', totals: 'الإجماليات', notes: 'ملاحظات', name: 'الاسم', date: 'التاريخ', amount: 'المبلغ', status: 'الحالة', from: 'من', to: 'إلى', optional: 'اختياري',
    confirmDelete: 'حذف «{name}»؟ لا يمكن الرجوع إلا بزر التراجع مباشرة بعد الحذف.',
    deleted: 'تم حذف «{name}»', duplicated: 'تم إنشاء نسخة', restored: 'تمت الاستعادة',
    copySuffix: '(نسخة)',
    required: 'هذا الحقل مطلوب',
    invalidNumber: 'أدخل رقمًا',

    homeTitle: 'العملاء والعمليات',
    homeIntro: 'كل عميل أو عملية يُفتح في تبويب مستقل له دفتر حركاته وشركاؤه وضرائبه وتقاريره.',
    homeEmpty: 'لا يوجد عملاء أو عمليات بعد. أنشئ واحدًا للبدء، أو افتح المثال لتجربة كل الحسابات.',
    createJob: 'إنشاء عميل / عملية', openSample: 'فتح عملية مثال',
    sampleName: 'مثال — فلل النور', sampleClient: 'شركة النور العقارية',
    colClient: 'العميل', colCurrency: 'العملة', colNetProfit: 'صافي الربح', colUpdated: 'آخر تعديل', colTab: 'التبويب',
    tabOpen: 'مفتوح', tabClosed: 'مغلق',
    searchJobs: 'ابحث بالاسم أو العميل',
    noMatches: 'لا توجد نتائج لـ «{q}».',

    jobName: 'اسم العميل / العملية', jobNamePh: 'مثال: تشطيب فيلا — أ. أحمد',
    clientName: 'اسم العميل', currency: 'العملة', color: 'لون التبويب',
    jobPeriod: 'الفترة المحاسبية', periodThisYear: 'هذه السنة', periodLastYear: 'السنة الماضية', periodAll: 'كل التواريخ', periodCustom: 'تواريخ محددة',

    nav_overview: 'نظرة عامة', nav_ledger: 'الإيرادات والمصروفات', nav_sections: 'الأقسام', nav_partners: 'الشركاء والحصص',
    nav_assets: 'الأصول والإهلاك', nav_loans: 'القروض', nav_tax: 'الضريبة والزكاة', nav_analysis: 'التحليل المالي',
    nav_calculators: 'حاسبات', nav_report: 'التقرير', nav_settings: 'إعدادات العملية',
    periodLabel: 'الفترة', allDates: 'كل التواريخ', entries: '{n} حركة',

    kind_revenue: 'مبيعات / إيرادات', kind_returns: 'مردودات ومسموحات المبيعات', kind_cogs: 'تكلفة مباشرة (تكلفة المبيعات)',
    kind_opex: 'مصروف تشغيلي', kind_otherIncome: 'إيرادات أخرى', kind_otherExpense: 'مصروفات أخرى',
    kindShort_revenue: 'إيراد', kindShort_returns: 'مردودات', kindShort_cogs: 'تكلفة مباشرة', kindShort_opex: 'مصروف', kindShort_otherIncome: 'إيراد آخر', kindShort_otherExpense: 'مصروف آخر',

    kpiNetRevenue: 'صافي الإيرادات', kpiTotalCosts: 'إجمالي التكاليف', kpiNetProfit: 'صافي الربح', kpiNetLoss: 'صافي الخسارة', kpiNetMargin: 'هامش صافي الربح',
    kpiGrossProfit: 'مجمل الربح', kpiVatDue: 'ضريبة القيمة المضافة المستحقة', kpiVatRefund: 'ضريبة قيمة مضافة مستردة', kpiReceivables: 'مستحق من العملاء', kpiPayables: 'مستحق للموردين', kpiCash: 'النقدية (تقديري)',
    chartTitle: 'الإيرادات والمصروفات حسب {g}', g_month: 'الشهر', g_quarter: 'الربع', g_year: 'السنة',
    seriesIncome: 'الإيرادات', seriesExpenses: 'المصروفات', seriesResult: 'النتيجة',
    chartUndated: '{n} حركة بدون تاريخ محسوبة في الإجماليات وغير ظاهرة في الرسم.',
    showTable: 'عرض كجدول', showChart: 'عرض كرسم',
    topExpenses: 'أين تذهب الأموال', topIncome: 'من أين تأتي الأموال', uncategorized: 'بدون تصنيف',
    sharesSummary: 'حصص الشركاء من الربح', noPartnersYet: 'لا يوجد شركاء بعد — أضفهم من «الشركاء والحصص» لتوزيع الربح.',
    sectionsSummary: 'الربح حسب القسم',
    overviewEmpty: 'لا توجد حركات في هذه العملية بعد. أضف الإيرادات والمصروفات لترى الربح والضرائب والحصص.',
    addFirstEntry: 'إضافة أول حركة',

    pl_title: 'قائمة الدخل (الأرباح والخسائر)',
    pl_revenue: 'المبيعات / الإيرادات', pl_returns: 'يخصم: المردودات والمسموحات', pl_netRevenue: 'صافي الإيرادات', pl_cogs: 'يخصم: تكلفة المبيعات (التكاليف المباشرة)',
    pl_grossProfit: 'مجمل الربح', pl_opex: 'يخصم: المصروفات التشغيلية', pl_ebitda: 'الربح قبل الإهلاك والفوائد والضرائب (EBITDA)',
    pl_depreciation: 'يخصم: الإهلاك', pl_operatingProfit: 'الربح التشغيلي', pl_otherIncome: 'يضاف: إيرادات أخرى', pl_otherExpense: 'يخصم: مصروفات أخرى',
    pl_financeCosts: 'يخصم: فوائد القروض (تكاليف التمويل)', pl_pbt: 'الربح قبل الضريبة', pl_incomeTax: 'يخصم: ضريبة الدخل', pl_zakat: 'يخصم: الزكاة',
    pl_netProfit: 'صافي الربح', pl_netLoss: 'صافي الخسارة', pl_ofRevenue: '% من الإيرادات',

    addIncome: 'إضافة إيراد', addExpense: 'إضافة مصروف', addEntry: 'إضافة حركة', editEntry: 'تعديل حركة',
    filterKind: 'النوع', filterSection: 'القسم', filterStatus: 'السداد', onlyPeriod: 'داخل الفترة فقط',
    status_paid: 'مسدد', status_partial: 'مسدد جزئيًا', status_unpaid: 'غير مسدد',
    colType: 'النوع', colSection: 'القسم', colCategory: 'التصنيف', colDescription: 'البيان', colParty: 'العميل / المورد',
    colNet: 'الصافي', colVat: 'الضريبة', colGross: 'الإجمالي', colPaid: 'المسدد', colBalance: 'المتبقي',
    outsidePeriod: 'خارج الفترة',
    ledgerEmpty: 'لا توجد حركات بعد. أضف إيرادًا أو مصروفًا وستتحدث كل الإجماليات.',
    ledgerNoMatch: 'لا توجد حركات مطابقة لهذه الفلاتر.',
    showMore: 'عرض {n} أخرى',
    f_kind: 'نوع الحركة', f_date: 'التاريخ', f_section: 'القسم', f_category: 'التصنيف', f_description: 'البيان',
    f_party: 'العميل / المورد', f_qty: 'الكمية', f_unitPrice: 'سعر الوحدة', f_amount: 'المبلغ',
    f_amountHelpNet: 'قبل الضريبة', f_amountHelpGross: 'شامل الضريبة', f_amountAuto: 'الكمية × سعر الوحدة',
    f_vat: 'خاضع لضريبة القيمة المضافة', f_vatRate: 'نسبة الضريبة %', f_vatRatePh: 'نسبة العملية ({r}%)', f_status: 'حالة السداد', f_paid: 'المبلغ المسدد حتى الآن', f_ref: 'رقم الفاتورة / المرجع', f_notes: 'ملاحظات',
    previewNet: 'الصافي', previewVat: 'الضريبة', previewGross: 'الإجمالي',

    sectionsIntro: 'قسّم العملية إلى أجزاء — مواقع أو فروع أو منتجات أو مراحل — واعرف ربح كل جزء على حدة.',
    addSection: 'إضافة قسم', editSection: 'تعديل قسم', sectionName: 'اسم القسم', sectionNamePh: 'مثال: عمارة أ، فرع 2، المرحلة الأولى',
    sectionsEmpty: 'لا توجد أقسام بعد. كل الحركات تُحسب على العملية ككل.',
    unassigned: 'غير مخصص (مشترك)',
    col_netRevenue: 'صافي الإيرادات', col_cogs: 'التكاليف المباشرة', col_grossProfit: 'مجمل الربح', col_opex: 'مصروفات تشغيلية', col_other: 'أخرى (+/−)',
    col_depreciation: 'الإهلاك', col_profit: 'الربح', col_margin: 'الهامش', col_revShare: 'نصيبه من الإيرادات', col_allocated: 'تكاليف مشتركة محمّلة', col_profitAfter: 'الربح بعد التحميل',
    allocateShared: 'توزيع التكاليف المشتركة (غير المخصصة) على الأقسام حسب نصيب كل قسم من الإيرادات',
    sectionsNote: 'ربح القسم قبل فوائد القروض وضريبة الدخل والزكاة، فهذه تخص العملية ككل.',
    sectionDeleteNote: 'الحركات المسجلة في «{name}» ستصبح غير مخصصة.',

    partnersIntro: 'يوزَّع صافي الربح بهذا الترتيب: الاحتياطيات ← رواتب الشركاء ← الفائدة على رأس المال ← نسب الإدارة ← الباقي حسب نسبة كل شريك.',
    shareMethod: 'توزيع باقي الربح حسب', method_manual: 'نسب متفق عليها', method_capital: 'رأس المال المدفوع', method_shares: 'عدد الحصص / الأسهم', method_weighted: 'رأس المال × المدة داخل الفترة',
    interestOnCapital: 'فائدة على رأس المال (% سنويًا)', legalReserve: 'الاحتياطي القانوني (% من صافي الربح)', otherReserve: 'احتياطيات أخرى / أرباح محتجزة (% من صافي الربح)',
    addPartner: 'إضافة شريك', editPartner: 'تعديل شريك', partnersEmpty: 'لا يوجد شركاء بعد. أضف كل شريك برأس ماله ونسبته.',
    p_name: 'اسم الشريك', p_capital: 'رأس المال', p_joinDate: 'تاريخ دفع رأس المال', p_joinHelp: 'اتركه فارغًا إذا كان شريكًا من البداية', p_sharePct: 'نسبة الربح %', p_shares: 'عدد الحصص',
    p_salary: 'راتب الشريك عن الفترة', p_salaryHelp: 'يُصرف من الربح قبل التوزيع', p_bonusPct: 'نسبة الإدارة %', p_bonusHelp: 'تُخصم أولًا مقابل إدارة العمل', p_drawings: 'المسحوبات (ما سحبه فعلًا)',
    d_title: 'كيف يوزَّع الربح', d_netProfit: 'صافي ربح الفترة', d_legalReserve: 'يخصم: الاحتياطي القانوني', d_otherReserve: 'يخصم: احتياطيات أخرى',
    d_salaries: 'يخصم: رواتب الشركاء', d_interest: 'يخصم: الفائدة على رأس المال', d_bonuses: 'يخصم: نسب الإدارة', d_distributable: 'الربح الموزع حسب النسب', d_lossToShare: 'الخسارة الموزعة حسب النسب',
    r_ratio: 'النسبة', r_salary: 'الراتب', r_interest: 'الفائدة', r_bonus: 'نسبة الإدارة', r_residual: 'نصيبه من الباقي', r_total: 'إجمالي نصيبه', r_drawings: 'المسحوبات', r_due: 'المستحق للشريك', r_owes: 'على الشريك', r_closing: 'رأس المال الختامي',
    unallocatedProfit: 'غير موزع على أحد', profitPerShare: 'ربح الحصة الواحدة',
    warnSharesNot100: 'مجموع النسب المتفق عليها {total}% وليس 100%. الفرق يبقى غير موزع.',
    warnNoBasis: 'أدخل رأس المال أو عدد الحصص للشركاء — طريقة التوزيع المختارة لا تجد ما تقسم عليه.',
    warnBonusOver100: 'مجموع نسب الإدارة {total}% من الربح.',

    assetsIntro: 'الأصول الثابتة تفقد قيمتها على مدى عمرها الإنتاجي. إهلاك هذه الفترة يُخصم من الربح تلقائيًا.',
    addAsset: 'إضافة أصل', editAsset: 'تعديل أصل', assetsEmpty: 'لا توجد أصول بعد. أضف المعدات أو السيارات أو الأثاث المستخدم في العملية.',
    a_name: 'الأصل', a_cost: 'التكلفة', a_salvage: 'قيمة الخردة', a_life: 'العمر الإنتاجي (سنوات)', a_method: 'الطريقة', a_start: 'بداية الاستخدام', a_section: 'القسم',
    a_periodDep: 'إهلاك الفترة', a_accumulated: 'مجمع الإهلاك', a_bookValue: 'القيمة الدفترية',
    method_sl: 'القسط الثابت', method_ddb: 'القسط المتناقص المضاعف', method_syd: 'مجموع أرقام السنوات', method_none: 'لا يُهلك (مثل الأراضي)',
    scheduleTitle: 'جدول الإهلاك — {name}', s_year: 'السنة', s_starts: 'تبدأ', s_dep: 'الإهلاك', s_acc: 'المجمع', s_bv: 'القيمة الدفترية',
    showSchedule: 'الجدول', hideSchedule: 'إخفاء الجدول',

    loansIntro: 'أقساط القرض شهرية. الفوائد المستحقة داخل الفترة تُخصم من الربح تلقائيًا.',
    addLoan: 'إضافة قرض', editLoan: 'تعديل قرض', loansEmpty: 'لا توجد قروض بعد.',
    l_name: 'القرض / الجهة المقرضة', l_principal: 'مبلغ القرض', l_rate: 'الفائدة السنوية %', l_months: 'المدة (شهور)', l_type: 'طريقة السداد', l_start: 'تاريخ الاستلام',
    l_payment: 'القسط', l_totalInterest: 'إجمالي الفوائد', l_periodInterest: 'فوائد الفترة', l_balance: 'الرصيد في نهاية الفترة',
    loan_annuity: 'أقساط متساوية', loan_equal: 'أصل متساوٍ', loan_bullet: 'فوائد فقط والأصل في النهاية',
    amortTitle: 'جدول السداد — {name}', am_no: 'م', am_due: 'الاستحقاق', am_payment: 'القسط', am_interest: 'الفائدة', am_principal: 'الأصل', am_balance: 'الرصيد',

    vatTitle: 'ضريبة القيمة المضافة', vatEnabled: 'العملية تحصّل / تدفع ضريبة القيمة المضافة', vatRate: 'النسبة العامة %', vatInclusive: 'المبالغ تُدخل شاملة الضريبة', vatPaidToAuthority: 'ضريبة سُددت بالفعل لمصلحة الضرائب',
    vatSalesBase: 'المبيعات الخاضعة (صافي)', vatOutput: 'ضريبة المبيعات (المخرجات)', vatOutputReturns: 'يخصم: ضريبة المردودات', vatInput: 'يخصم: ضريبة المشتريات (المدخلات)', vatNet: 'صافي ضريبة الفترة', vatPaid: 'يخصم: المسدد بالفعل', vatBalanceDue: 'ضريبة متبقية للسداد', vatBalanceRefund: 'ضريبة مستردة / مرحّلة',
    taxTitle: 'ضريبة الدخل', taxMode: 'طريقة حساب ضريبة الدخل', tax_none: 'بدون ضريبة دخل', tax_flat: 'نسبة ثابتة', tax_brackets: 'شرائح (تصاعدية)',
    taxFlatRate: 'نسبة الضريبة %', taxBrackets: 'الشرائح الضريبية', bracketUpTo: 'الربح حتى', bracketRate: 'النسبة %', bracketRest: 'وما فوق', addBracket: 'إضافة شريحة',
    taxPresets: 'إعدادات جاهزة', preset_eg: 'شركات مصر 22.5%', preset_sa: 'السعودية 20%', preset_ae: 'الإمارات 9% فوق 375,000', preset_none: 'بدون',
    taxableProfit: 'الربح الخاضع', taxAmount: 'ضريبة الدخل', effectiveRate: 'النسبة الفعلية',
    zakatTitle: 'الزكاة', zakatMode: 'وعاء الزكاة', zakat_none: 'بدون زكاة', zakat_profit: 'صافي الربح بعد الضريبة', zakat_netAssets: 'صافي الأصول المتداولة', zakat_manual: 'مبلغ أدخله بنفسي',
    zakatRate: 'نسبة الزكاة %', zakatRateHijri: '2.5% (سنة هجرية)', zakatRateGregorian: '2.5775% (سنة ميلادية)', zakatNisab: 'النصاب (الحد الأدنى)', zakatManualBase: 'وعاء الزكاة',
    zakatBase: 'وعاء الزكاة', zakatAmount: 'الزكاة المستحقة', zakatBelowNisab: 'أقل من النصاب — لا زكاة مستحقة.',
    zakatNetAssetsHelp: 'النقدية + أرصدة العملاء + المخزون + أصول متداولة أخرى − أرصدة الموردين − الضريبة المستحقة − التزامات قصيرة الأجل أخرى − أقساط القروض المستحقة خلال سنة. عدّل هذه الأرقام من التحليل المالي ← المركز المالي.',
    taxDisclaimer: 'تقديرات للتخطيط. القواعد تختلف من بلد لآخر وتتغير — راجع الأرقام النهائية مع مستشارك الضريبي.',

    ratiosTitle: 'أهم النسب المالية', positionTitle: 'المركز المالي في نهاية الفترة', cashTitle: 'التدفقات النقدية (تقديري)', breakEvenTitle: 'نقطة التعادل', partiesTitle: 'أرصدة العملاء والموردين',
    ratio_grossMargin: 'هامش مجمل الربح', ratio_ebitdaMargin: 'هامش EBITDA', ratio_operatingMargin: 'هامش الربح التشغيلي', ratio_netMargin: 'هامش صافي الربح', ratio_costRatio: 'التكلفة لكل 1 من الإيراد', ratio_opexRatio: 'المصروفات التشغيلية / الإيرادات',
    ratio_returnOnCapital: 'العائد على رأس مال الشركاء', ratio_roe: 'العائد على حقوق الملكية', ratio_roa: 'العائد على الأصول', ratio_currentRatio: 'نسبة التداول', ratio_quickRatio: 'نسبة السيولة السريعة', ratio_debtToEquity: 'الالتزامات إلى حقوق الملكية',
    ratio_workingCapital: 'رأس المال العامل', ratio_collectionRate: 'نسبة التحصيل من العملاء', ratio_receivableDays: 'أيام التحصيل', ratio_payableDays: 'أيام السداد للموردين', ratio_interestCover: 'تغطية الفوائد',
    ratioHelp_currentRatio: 'الأصول المتداولة ÷ الالتزامات المتداولة. أكثر من 1 يعني أن الديون القصيرة مغطاة.',
    ratioHelp_quickRatio: 'مثل نسبة التداول لكن بدون المخزون.',
    ratioHelp_interestCover: 'الربح التشغيلي ÷ فوائد القروض.',
    ratioHelp_costRatio: 'كل 1 من الإيراد يكلف هذا المبلغ.',
    times: '{x} مرة', days: '{x} يوم', notAvailable: '—',
    pos_cash: 'النقدية بالصندوق والبنك', pos_receivables: 'أرصدة العملاء (المدينون)', pos_inventory: 'المخزون', pos_otherCurrentAssets: 'أصول متداولة أخرى', pos_vatCredit: 'ضريبة قيمة مضافة مستردة', pos_currentAssets: 'الأصول المتداولة',
    pos_fixedAssets: 'الأصول الثابتة (القيمة الدفترية)', pos_totalAssets: 'إجمالي الأصول', pos_payables: 'أرصدة الموردين (الدائنون)', pos_vatPayable: 'ضريبة قيمة مضافة مستحقة', pos_taxPayable: 'ضريبة دخل مستحقة', pos_zakatPayable: 'زكاة مستحقة',
    pos_otherCurrentLiabilities: 'التزامات قصيرة الأجل أخرى', pos_loanCurrent: 'أقساط قروض مستحقة خلال سنة', pos_currentLiabilities: 'الالتزامات المتداولة', pos_loanNonCurrent: 'قروض طويلة الأجل', pos_totalLiabilities: 'إجمالي الالتزامات', pos_equity: 'صافي الأصول (حقوق الملكية)',
    pos_inputs: 'أرقام تدخلها بنفسك', pos_openingCash: 'النقدية في بداية الفترة', pos_cashOverride: 'النقدية الفعلية في نهاية الفترة', pos_cashOverrideHelp: 'اتركه فارغًا لاستخدام التقدير من التدفقات النقدية',
    cash_opening: 'النقدية في البداية', cash_collections: 'المحصل من العملاء', cash_refunds: 'المردود للعملاء', cash_payments: 'المدفوع للموردين والمصروفات', cash_vatPaid: 'ضريبة مدفوعة للمصلحة', cash_operating: 'صافي النقدية من التشغيل',
    cash_assetPurchases: 'شراء أصول', cash_investing: 'صافي النقدية في الاستثمار', cash_capitalIn: 'رأس مال دفعه الشركاء', cash_loansIn: 'قروض مستلمة', cash_loanPayments: 'أقساط قروض مدفوعة', cash_drawings: 'مسحوبات الشركاء', cash_financing: 'صافي النقدية من التمويل', cash_netChange: 'صافي التغير في النقدية', cash_closing: 'النقدية في النهاية (تقديري)',
    be_fromLedger: 'من أرقام هذه العملية', be_fromLedgerHelp: 'التكاليف المباشرة تعتبر متغيرة، وباقي التكاليف ثابتة.', be_fixed: 'التكاليف الثابتة', be_variableRatio: 'نسبة التكلفة المتغيرة', be_contributionRatio: 'نسبة هامش المساهمة', be_revenue: 'إيرادات التعادل', be_mos: 'هامش الأمان', be_impossible: 'التكاليف المباشرة تستهلك كل الإيرادات — لا توجد نقطة تعادل.',
    be_manual: 'بالوحدة', be_price: 'سعر بيع الوحدة', be_vc: 'التكلفة المتغيرة للوحدة', be_units: 'عدد الوحدات المتوقع بيعها', be_target: 'الربح المستهدف',
    be_cm: 'هامش المساهمة للوحدة', be_beUnits: 'وحدات التعادل', be_beRevenue: 'مبيعات التعادل', be_targetUnits: 'وحدات الربح المستهدف', be_targetRevenue: 'مبيعات الربح المستهدف', be_expectedProfit: 'الربح المتوقع', be_mosUnits: 'هامش الأمان (وحدات)', be_dol: 'الرافعة التشغيلية',
    be_invalid: 'سعر البيع يجب أن يكون أعلى من التكلفة المتغيرة للوحدة.',
    party_name: 'الاسم', party_sales: 'المبيعات', party_purchases: 'المشتريات', party_receivable: 'مستحق لنا', party_payable: 'مستحق علينا', partiesEmpty: 'أضف اسم العميل أو المورد في الحركات لترى الأرصدة هنا.',

    calcIntro: 'أدوات سريعة لحسابات منفصلة. لا تغيّر أرقام هذه العملية.',
    c_percent: 'النسب المئوية', c_pctOf: 'نسبة من رقم', c_whatPct: 'كم نسبة أ من ب', c_change: 'نسبة التغير من أ إلى ب', c_pct: 'النسبة', c_number: 'الرقم', c_a: 'أ', c_b: 'ب',
    c_vat: 'إضافة أو استخراج الضريبة', c_net: 'المبلغ قبل الضريبة', c_gross: 'المبلغ شامل الضريبة', c_rate: 'النسبة %', c_vatAmount: 'الضريبة', c_vatOnNet: 'الضريبة على المبلغ قبل الضريبة', c_grossFromNet: 'الإجمالي شامل الضريبة', c_vatInGross: 'الضريبة داخل المبلغ الشامل', c_netFromGross: 'المبلغ قبل الضريبة',
    c_pricing: 'التسعير والهامش والإضافة', c_cost: 'التكلفة', c_price: 'سعر البيع', c_markup: 'نسبة الإضافة على التكلفة %', c_margin: 'هامش الربح %', c_profit: 'الربح', c_priceAtMarkup: 'السعر بهذه الإضافة', c_priceAtMargin: 'السعر لهذا الهامش', c_discountPct: 'نسبة الخصم %', c_discount: 'الخصم', c_afterDiscount: 'السعر بعد الخصم',
    c_loan: 'قسط القرض', c_principal: 'مبلغ القرض', c_annualRate: 'الفائدة السنوية %', c_months: 'الشهور', c_payment: 'القسط الشهري', c_totalInterest: 'إجمالي الفوائد', c_totalPaid: 'إجمالي المسدد',
    c_simple: 'الفائدة البسيطة', c_years: 'السنوات', c_interest: 'الفائدة', c_totalAmount: 'الإجمالي',
    c_compound: 'الادخار والنمو المركب', c_pv: 'المبلغ الابتدائي', c_perYear: 'مرات التركيب في السنة', c_contribution: 'إضافة كل فترة', c_fv: 'القيمة المستقبلية', c_invested: 'إجمالي المدفوع', c_gain: 'النمو',
    c_investment: 'تقييم الاستثمار (صافي القيمة الحالية / معدل العائد الداخلي)', c_discountRate: 'معدل الخصم %', c_initial: 'الاستثمار المبدئي', c_flows: 'التدفقات النقدية لكل سنة', c_flowsHelp: 'افصل بينها بفاصلة أو مسافة، مثال: 3000، 4000، 5000',
    c_npv: 'صافي القيمة الحالية', c_irr: 'معدل العائد الداخلي', c_payback: 'فترة الاسترداد', c_dpayback: 'فترة الاسترداد المخصومة', c_pi: 'مؤشر الربحية', c_years_x: '{x} سنة', c_never: 'لا يُسترد',
    c_roi: 'العائد على الاستثمار', c_amountInvested: 'المبلغ المستثمر', c_finalValue: 'القيمة الحالية / المستلم', c_roiPct: 'العائد', c_cagr: 'معدل النمو السنوي (CAGR)',
    c_currency: 'تحويل العملات', c_rateEx: 'سعر الصرف (الوحدة =)', c_result: 'الناتج',

    reportTitle: 'التقرير المالي', reportFor: 'مُعد لـ', reportPeriod: 'الفترة', reportGenerated: 'تاريخ الإعداد', reportCurrency: 'العملة', reportPrintHint: 'تُطبع هذه الصفحة على مقاس A4. استخدم «حفظ PDF» للاحتفاظ بنسخة.',

    jobDetails: 'بيانات العميل والعملية', c_phone: 'الهاتف', c_email: 'البريد الإلكتروني', c_address: 'العنوان', c_taxId: 'رقم التسجيل الضريبي', jobNotes: 'ملاحظات عن العملية',
    periodHelp: 'الحركات المؤرخة خارج الفترة تبقى محفوظة لكنها لا تُحسب. اترك التاريخين فارغين لحساب كل شيء.',
    calcOptions: 'الخصومات التلقائية', autoDepreciation: 'خصم إهلاك الأصول من الربح', autoLoanInterest: 'خصم فوائد القروض من الربح',
    dangerZone: 'حذف هذه العملية', deleteJob: 'حذف العملية نهائيًا', deleteJobHelp: 'يحذف العملية وكل حركاتها. يمكنك التراجع مباشرة بعد الحذف.',
    language: 'اللغة', digits: 'الأرقام', digitsLatn: '0123456789', digitsArab: '٠١٢٣٤٥٦٧٨٩', defaultCurrency: 'عملة العمليات الجديدة', dataFile: 'ملف البيانات', openDataFolder: 'فتح مجلد البيانات',
    backupDone: 'تم حفظ النسخة الاحتياطية', restoreDone: 'تمت استعادة البيانات من النسخة الاحتياطية', restoreConfirm: 'استبدال كل البيانات الحالية بالنسخة الاحتياطية؟ البيانات الحالية تبقى في الذاكرة حتى إغلاق البرنامج، فيمكنك التراجع مباشرة.', restoreBad: 'هذا الملف ليس نسخة احتياطية من High Level Calc.',
    excelDone: 'تم حفظ ملف Excel', pdfDone: 'تم حفظ ملف PDF', exportFailed: 'فشل التصدير: {msg}',
    browserMode: 'تعمل الآن كمعاينة في المتصفح — البيانات محفوظة في هذا المتصفح فقط.',

    period_from_to: '{from} – {to}',
    loss: 'خسارة', profit: 'ربح',
    perShare: 'للحصة',
    upToDate: 'محدّث',

    xl_settings: 'الإعدادات', xl_transactions: 'الحركات', xl_pl: 'قائمة الدخل', xl_partners: 'الشركاء', xl_sections: 'الأقسام', xl_assets: 'الأصول', xl_loans: 'القروض', xl_vat: 'ضريبة القيمة المضافة', xl_cash: 'النقدية والمركز المالي',
    xl_code: 'الرمز', xl_inPeriod: 'داخل الفترة', xl_days: 'أيام الفترة', xl_lower: 'من', xl_upper: 'حتى', xl_rateStep: 'فرق النسبة', xl_basis: 'أساس التوزيع', xl_afterReserves: 'الربح بعد الاحتياطيات', xl_opening: 'الرصيد الافتتاحي', xl_closing: 'الرصيد الختامي',
    xl_legend: 'الأرقام الزرقاء مدخلات يمكنك تغييرها. الخلايا السوداء معادلات. الخلايا الخضراء مرتبطة بورقة أخرى.',
    xl_appValues: 'الأرقام ذات العناوين الرمادية يحسبها High Level Calc للفترة (بالتناسب اليومي) وتُحفظ كقيم.',
    xl_netNote: 'المبالغ قبل الضريبة.', xl_unbounded: 'اترك خانة «حتى» فارغة لأعلى شريحة.'
  };

  // Suggested categories per kind (shown in the category picker).
  const categories = {
    en: {
      revenue: ['Sales', 'Services', 'Contract work', 'Consulting', 'Commission'],
      returns: ['Sales returns', 'Discounts allowed'],
      cogs: ['Materials', 'Direct labor', 'Subcontractors', 'Purchases', 'Freight & customs'],
      opex: ['Rent', 'Salaries & wages', 'Utilities', 'Transport & fuel', 'Marketing', 'Maintenance', 'Office supplies', 'Phone & internet', 'Fees & licenses', 'Insurance', 'Bank charges', 'Professional fees'],
      otherIncome: ['Interest income', 'Gain on asset sale', 'Miscellaneous'],
      otherExpense: ['Fines & penalties', 'Loss on asset sale', 'Bad debts', 'Miscellaneous']
    },
    ar: {
      revenue: ['مبيعات', 'خدمات', 'أعمال مقاولات', 'استشارات', 'عمولات'],
      returns: ['مردودات مبيعات', 'خصم مسموح به'],
      cogs: ['خامات', 'عمالة مباشرة', 'مقاولو باطن', 'مشتريات', 'نقل وجمارك'],
      opex: ['إيجار', 'رواتب وأجور', 'كهرباء ومياه', 'انتقالات ووقود', 'تسويق وإعلان', 'صيانة', 'أدوات مكتبية', 'هاتف وإنترنت', 'رسوم وتراخيص', 'تأمين', 'مصاريف بنكية', 'أتعاب مهنية'],
      otherIncome: ['فوائد دائنة', 'أرباح بيع أصول', 'متنوعة'],
      otherExpense: ['غرامات', 'خسائر بيع أصول', 'ديون معدومة', 'متنوعة']
    }
  };

  const CURRENCIES = ['EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'IQD', 'LYD', 'MAD', 'TND', 'DZD', 'SDG', 'LBP', 'SYP', 'YER', 'USD', 'EUR', 'GBP', 'TRY'];

  const dicts = { en, ar };
  let lang = 'ar';
  let digits = 'latn';
  const formatters = new Map();

  function setLang(l) { lang = dicts[l] ? l : 'en'; formatters.clear(); }
  function getLang() { return lang; }
  function setDigits(d) { digits = d === 'arab' ? 'arab' : 'latn'; formatters.clear(); }
  function dir() { return lang === 'ar' ? 'rtl' : 'ltr'; }
  function locale() { return (lang === 'ar' ? 'ar-EG' : 'en-GB') + '-u-nu-' + digits; }

  function t(key, vars) {
    let s = dicts[lang][key];
    if (s == null) s = en[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }

  function nf(key, opts) {
    const k = key + JSON.stringify(opts);
    if (!formatters.has(k)) formatters.set(k, new Intl.NumberFormat(locale(), opts));
    return formatters.get(k);
  }

  function currencyDigits(cur) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits; }
    catch (e) { return 2; }
  }

  // Plain number with grouping. Default 2 decimals.
  function fmtNum(x, d) {
    if (x == null || !isFinite(x)) return t('notAvailable');
    const dd = d == null ? 2 : d;
    const v = Math.abs(x) < 0.5 * Math.pow(10, -dd) ? 0 : x; // avoid "-0.00"
    return nf('n', { minimumFractionDigits: dd, maximumFractionDigits: dd }).format(v);
  }

  // Amount in the job's currency, without the symbol (for tables).
  function fmtAmount(x, cur) {
    return fmtNum(x, currencyDigits(cur || 'USD'));
  }

  function fmtMoney(x, cur) {
    if (x == null || !isFinite(x)) return t('notAvailable');
    const d = currencyDigits(cur);
    const v = Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x;
    try {
      return nf('m' + cur, { style: 'currency', currency: cur, currencyDisplay: lang === 'ar' ? 'symbol' : 'code' }).format(v);
    } catch (e) {
      return fmtNum(v, d) + ' ' + cur;
    }
  }

  // Compact money for tiles: 1.2M, 950K
  function fmtCompact(x, cur) {
    if (x == null || !isFinite(x)) return t('notAvailable');
    if (Math.abs(x) < 100000) return fmtMoney(x, cur);
    try {
      return nf('c' + cur, { style: 'currency', currency: cur, currencyDisplay: lang === 'ar' ? 'symbol' : 'code', notation: 'compact', maximumFractionDigits: 2 }).format(x);
    } catch (e) { return fmtMoney(x, cur); }
  }

  function fmtCompactNum(x) {
    if (x == null || !isFinite(x)) return t('notAvailable');
    return nf('cn', { notation: 'compact', maximumFractionDigits: 1 }).format(x);
  }

  // x is a fraction (0.25 → 25.0%)
  function fmtPct(x, d) {
    if (x == null || !isFinite(x)) return t('notAvailable');
    return nf('p', { style: 'percent', minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }).format(x);
  }

  function fmtDate(iso, style) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const opts = style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : style === 'month' ? { month: 'short', timeZone: 'UTC' }
      : style === 'monthYear' ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : style === 'year' ? { year: 'numeric', timeZone: 'UTC' }
      : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };
    const k = 'd' + JSON.stringify(opts);
    if (!formatters.has(k)) formatters.set(k, new Intl.DateTimeFormat(locale(), opts));
    return formatters.get(k).format(d);
  }

  function currencyName(code) {
    try {
      const dn = new Intl.DisplayNames([lang === 'ar' ? 'ar' : 'en'], { type: 'currency' });
      return dn.of(code) || code;
    } catch (e) { return code; }
  }

  // Accepts Arabic-Indic / Persian digits, Arabic separators and grouping commas.
  function parseNumber(text) {
    if (typeof text === 'number') return text;
    if (text == null) return null;
    let s = String(text).trim();
    if (!s) return null;
    s = s.replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
      .replace(/٫/g, '.').replace(/[٬,\s٬]/g, '').replace(/[−–]/g, '-').replace(/%$/, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }

  return {
    dicts, categories, CURRENCIES,
    setLang, getLang, setDigits, dir, locale, t,
    fmtNum, fmtAmount, fmtMoney, fmtCompact, fmtCompactNum, fmtPct, fmtDate, currencyName, currencyDigits, parseNumber
  };
});
