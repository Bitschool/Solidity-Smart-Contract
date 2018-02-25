
pragma solidity^0.4.18;

import "../zeppelin-solidity-master/contracts/token/PausableToken.sol";

contract BitSchoolToken is PausableToken {
    // GENERAL INFORMATION ABOUT THE TOKEN
    string public constant name = "BitSchool Token";
    string public constant symbol = "BSCH";
    uint256 public constant decimals = 18;
    string public version = "1.0";

    uint256 public constant ONE_COIN = 10 ** uint256(decimals);
    uint256 public constant ONE_MILL_COIN = (10 ** 6) * ONE_COIN;
    uint256 public constant TOTAL_COIN_SUPPLY = 400 * ONE_MILL_COIN; // 400 Million Total Supply
    uint256 public constant MAX_PRESALE_SUPPLY = 4 * ONE_MILL_COIN; // Presale HARD CAP
    uint256 public constant ICO_SOFTCAP = 4 * ONE_MILL_COIN; // ICO Soft Cap
    uint256 public constant ICO_HARDCAP = 300 * ONE_MILL_COIN; // HARD CAP 260 Million coins available to public
    uint256 public constant PUBLIC_COINS = ICO_HARDCAP + MAX_PRESALE_SUPPLY;
    uint256 public constant MIN_CONTRIBUTION = (1 ether / 100); // Min Contribution = 0.01 eth
    uint256 public totalSold; // Number bitschool coins sold
    uint256 public totalWei; // total wei recieved during crowdsale

    uint256 public constant totalSupply = TOTAL_COIN_SUPPLY;
    
    // Coin Prices
    uint256 public constant PRICE_DEFAULT = 6000; // Price BSCH per 1 ETH (Roughly $0.20)
    uint256 public constant PRICE_PRE_ICO = (PRICE_DEFAULT * 135) / 100; // 35% more BSCH in Pre sale
    uint256 public constant PRICE_STAGE_ONE = (PRICE_DEFAULT * 115) / 100; // 15% more BSCH for stage 1
    uint256 public constant PRICE_STAGE_TWO = (PRICE_DEFAULT * 110) / 100; // 10% more BSCH for stage 2
    uint256 public constant PRICE_STAGE_THREE = (PRICE_DEFAULT * 105) / 100; // 5% more BSCH for stage 3
    uint256 public constant PRICE_STAGE_FOUR = PRICE_DEFAULT; // Default price for stage 4

    uint256 public constant BITSCHOOL_FAMILY_SUPPLY = 68 * ONE_MILL_COIN; // Reserved for Founders, advisors and team members
    uint256 public constant APPROVED_FUNDS = 332 * ONE_MILL_COIN;
    uint public constant FAMILY_LOCK_DURA = 180 days;
    bool public familyLockWithdrawn = false;

    bool public raisedWeiReturn = false; // boolean used to signal when raised funds are returned to wallet if ICO softcap not reached.

    // The address where all ICO funds are collected
    address public contributionWallet;

    // Time limits
    uint256 public preSaleStartTime;                                            // Start presale time
    uint256 public preSaleEndTime;                                              // End presale time
    uint256 public saleStartTime;                                               // Start sale time (start crowdsale)
    uint256 public saleEndTime;                                                 // End crowdsale

    // Investor contributions
    mapping(address => uint256) weiBalances;


    /**
     * @dev Event used to log coin purchases
     * @param purchaser Address that paid for the tokens
     * @param receiver Address that got the tokens
       @param amountWei The amount of wei that was used to buy tokens
     * @param amountCoins The amount of tokens that were bought
     */
    event CoinPurchase(address indexed purchaser, address indexed receiver, uint256 amountWei, uint256 amountCoins);

    /**
     * @dev Event to signal that coins have been reserved for a purchase from another altcoin - e.g. BTC
     * @param amount The amount of tokens that are being reserved
     */
    event ReserveCoins(uint256 amount);

    /**
     * @dev Event to signal that a refund was given
     * @param receiver The address that received the refund
     * @param amount The amount that is being refunded (in wei)
     */
    event RefundGiven(address indexed receiver, uint256 amount);

    /**
     * @param _preSaleStartTime Unix timestamp for the start of the token presale
     * @param _preSaleEndTime Unix timestamp for the end of the token presale
     * @param _saleStartTime Unix timestamp for the start of the token sale
     * @param _saleEndTime Unix timestamp for the end of the token sale
     * @param _contributionWallet Ethereum address to which the invested funds are forwarded
     */
    function BitSchoolToken(uint256 _preSaleStartTime, uint256 _preSaleEndTime, uint256 _saleStartTime, uint256 _saleEndTime, address _contributionWallet) public {
        require(_contributionWallet != address(0));
        require(now <= _preSaleStartTime);
        require(_preSaleStartTime < _preSaleEndTime);
        require(_preSaleEndTime < _saleStartTime);
        require(_saleStartTime < _saleEndTime);

        preSaleStartTime = _preSaleStartTime;
        preSaleEndTime = _preSaleEndTime;
        saleStartTime = _saleStartTime;
        saleEndTime = _saleEndTime;
        contributionWallet = _contributionWallet;

        balances[owner] = totalSupply;
        Transfer(address(0), owner, balances[owner]);

        assert(approve(owner, APPROVED_FUNDS));
        lockFamilyCoins();
    }

    /**
     * @dev Function used to allow buyers to send wei directly to the contract, if owner, used to allow refunds
     */
    function () external payable {
        if (msg.sender == contributionWallet) {
            require(now >= saleEndTime && totalSold < ICO_SOFTCAP);
            raisedWeiReturn = true;
        } else {
            buyCoins(msg.sender);
        }
    }

    /**
     * @dev Function used to allow supporters to buy tokens
     * @param receiver The address to sent to bought tokens to
     */
    function buyCoins(address receiver) public payable returns (bool) {
        require(receiver != address(0));
        require(msg.value >= MIN_CONTRIBUTION);
        
        if (isPreSaleTime()){
            processPurchase(receiver, msg.value, MAX_PRESALE_SUPPLY);
            if (totalSold >= MAX_PRESALE_SUPPLY) {
                preSaleEndTime = now;
            }
            return true;
        } 
        if (isSaleTime()){
            processPurchase(receiver, msg.value, ICO_HARDCAP);
            // If all coins sold for ico
            if (totalSold >= ICO_HARDCAP) {
                saleEndTime = now;
            }
            return true;
        }
        require(false);
    }

    function processPurchase(address receiver, uint256 amountWei, uint256 maxPurchase) internal {
        // Get current price of BSCH coins
        uint256 coinPrice = getCoinPrice();

        // Convert received Wei into coin total
        uint256 amountCoin = calcCoinFromWei(amountWei, coinPrice);
        uint256 returnToSender = 0;

        // Distribute only the remaining tokens if final contribution exceeds hard cap
        if (totalSold.add(amountCoin) > maxPurchase) {
            amountCoin = maxPurchase.sub(totalSold);
            amountWei = calcWeiFromCoin(amountCoin, coinPrice);
            returnToSender = msg.value.sub(amountWei);
        }

        totalSold = totalSold.add(amountCoin);
        totalWei = totalWei.add(amountWei);

        // Update stored wei amount for BSCH supporters
        weiBalances[receiver] = weiBalances[receiver].add(amountWei);
        
        assert(totalSold <= maxPurchase);
        balances[owner] = balances[owner].sub(amountCoin);
        balances[receiver] = balances[receiver].add(amountCoin);
        CoinPurchase(msg.sender, receiver, amountWei, amountCoin);

        // Transfer funds to BitSchool wallet
        contributionWallet.transfer(amountWei);

        // return any wei that is over the max amount allowed
        if (returnToSender > 0) {
            msg.sender.transfer(returnToSender);
        }
    }

    /**
     * @dev Function that returns how many tokens a supporter will get for a specific amount of Wei sent
     * @param _wei The amount in wei
       @param _rate The current exchange rate of the token per 1 ether
     */
    function calcCoinFromWei(uint _wei, uint _rate) public pure returns (uint) {
        return SafeMath.mul(_wei, _rate);
    }

    /**
     * @dev Function that returns how much Wei it is for X amount of tokens based on the rate passed
     * @param _coin The amount of tokens
       @param _rate The current exchange rate of the token per 1 ether
     */
    function calcWeiFromCoin(uint _coin, uint _rate) public pure returns (uint) {
        return SafeMath.div(_coin, _rate);
    }

    /**
     * @dev Function that returns the current exchange rate of the token based on the date.
     */
    function getCoinPrice() public view returns (uint256) {
        if (now < preSaleEndTime){
            return PRICE_PRE_ICO;
        }
        if (now < (saleStartTime + 1 weeks)){
            return PRICE_STAGE_ONE;
        }
        if (now < (saleStartTime + 2 weeks)){
            return PRICE_STAGE_TWO;
        }
        if (now < (saleStartTime + 3 weeks)){
            return PRICE_STAGE_THREE;
        }
        if (now < (saleStartTime + 4 weeks)){
            return PRICE_STAGE_FOUR;
        }
        return PRICE_DEFAULT;
    }

    /**
     * @dev Function used to allow supporters to claim a refund if the crowdsale was unsuccessful
     */
    function claimRefund() external {
        require(now > saleEndTime);
        require(totalSold < ICO_SOFTCAP);
        require(raisedWeiReturn);

        uint256 weiAmount = weiBalances[msg.sender];

        if(address(this).balance >= weiAmount) {
            weiBalances[msg.sender] = 0;
            if (weiAmount > 0) {
                msg.sender.transfer(weiAmount);
                RefundGiven(msg.sender, weiAmount);
            }
        }
    }

    /**
     * @dev Function that returns true if the presale is currently on
     */
    function isPreSaleTime() public view returns (bool) {
        return (now >= preSaleStartTime && now <= preSaleEndTime) && (totalSold < MAX_PRESALE_SUPPLY);
    }

    /**
     * @dev Function that returns true if the main crowdsale is currently on
     */
    function isSaleTime() public view returns (bool) {
        return (now >= saleStartTime && now <= saleEndTime) && (totalSold < ICO_HARDCAP);
    }

    /**
     * @dev Function that returns the current amount donated by a specific address
     * @param _owner The address to look up
     */
    function weiBalanceOf(address _owner) public view returns (uint256 balance) {
        return weiBalances[_owner];
    }

    /**
     * @dev Function that allows the presale dates to be changed BUT only if the cap has not yet been met.
     */
    function setPreSaleDates(uint256 _preSaleStartTime, uint256 _preSaleEndTime) external onlyOwner {
        require(_preSaleStartTime < _preSaleEndTime);
        require(now < _preSaleEndTime);
        require(totalSold < MAX_PRESALE_SUPPLY);

        preSaleStartTime = _preSaleStartTime;
        preSaleEndTime = _preSaleEndTime;
    }

    /**
     * @dev Function that allows the sale dates to be changed BUT only if the cap has not yet been met.
     */
    function setSaleDates(uint256 _saleStartTime, uint256 _saleEndTime) external onlyOwner {
        require(_saleStartTime < _saleEndTime);
        require(now < _saleEndTime);
        require(totalSold < ICO_HARDCAP);

        saleStartTime = _saleStartTime;
        saleEndTime = _saleEndTime;
    }

    /**
     * @dev Function that allows the owner to reserve coins for purchases in other currencies such as BTC
     * @param _amount The amount of tokens to reserve
     */
    function reserveSaleCoins(uint256 _amount) external onlyOwner {
        require(_amount > 0);
        uint256 amountCoin = _amount;
        if (totalSold.add(amountCoin) > ICO_HARDCAP) {
            amountCoin = ICO_HARDCAP.sub(totalSold);
            saleEndTime = now;
        }

        totalSold = totalSold.add(amountCoin);
        ReserveCoins(amountCoin);
    }

    function lockFamilyCoins() internal {
        balances[owner] = balances[owner].sub(BITSCHOOL_FAMILY_SUPPLY);
        balances[address(0)] = balances[address(0)].add(BITSCHOOL_FAMILY_SUPPLY);
        Transfer(owner, address(0), BITSCHOOL_FAMILY_SUPPLY);
    }


    /**
     * @dev Function that allows the owner to unlock the reserved family tokens after the specified time limit has expired
     */
    function unlockFamilyCoins() external onlyOwner {
        if ((saleEndTime + FAMILY_LOCK_DURA) < now && familyLockWithdrawn == false) {
            familyLockWithdrawn = true;
            balances[owner] = balances[owner].add(BITSCHOOL_FAMILY_SUPPLY);
            balances[address(0)] = balances[address(0)].sub(BITSCHOOL_FAMILY_SUPPLY);
            Transfer(address(0), owner, BITSCHOOL_FAMILY_SUPPLY);
        }
    }

    function transfer(address _to, uint _value) public returns (bool) {
        // Only allow transfers 14 days after ICO ends
        require(now >= (saleEndTime + 14 days));

        return super.transfer(_to, _value);
    }

    function transferFrom(address _from, address _to, uint _value) public returns (bool) {
        // Only owner's tokens can be transferred before ICO ends
        if (now < (saleEndTime + 14 days)){
            require(_from == owner);
        }          

        return super.transferFrom(_from, _to, _value);
    }

    function transferOwnership(address newOwner) public onlyOwner {
        // Only allow ownership transfers atleast 30 days after sale
        require(now >= (saleEndTime + 30 days));
        super.transferOwnership(newOwner);
    }
}