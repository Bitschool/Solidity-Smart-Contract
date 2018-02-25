var BitSchoolToken = artifacts.require("./BitSchoolToken.sol");

const DAY = 3600 * 24;
const WEEK = DAY * 7;

module.exports = function(deployer) {
  const preSaleStart = web3.eth.getBlock(web3.eth.blockNumber).timestamp + 1000;
  const preSaleEnd = preSaleStart + (WEEK * 4);
  const icoStart = preSaleEnd + (WEEK * 4);
  const icoEnd = icoStart + (WEEK * 4);

  deployer.deploy(BitSchoolToken, 
                preSaleStart,
                preSaleEnd,
                icoStart,
                icoEnd,
                0xac5646546c46c46c46c465,
                {gas: 5000000}
              );
};
