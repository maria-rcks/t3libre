function validateEmail(email) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(String(email).toLowerCase());
}

function validateUsername(username) {
  const re = /^[a-zA-Z0-9_]{3,20}$/;
  return re.test(username);
}

function validatePassword(password) {
  return password.length >= 8 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

module.exports = { validateEmail, validateUsername, validatePassword };
