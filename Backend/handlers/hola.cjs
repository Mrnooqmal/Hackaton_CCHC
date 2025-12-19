module.exports.printHello = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      mensaje: "queti"
    }),
  };
};
