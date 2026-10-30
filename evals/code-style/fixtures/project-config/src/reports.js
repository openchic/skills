const capitalize = value => value.slice(0, 1).toUpperCase() + value.slice(1);

exports.formatReportTitle = value => capitalize(value.trim());
