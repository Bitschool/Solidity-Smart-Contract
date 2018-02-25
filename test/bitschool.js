var Big = require('bignumber.js');
var BitSchoolToken = artifacts.require('./BitSchoolToken.sol');

const DAY = 3600 * 24;
const WEEK = DAY * 7;

const OWNER_ACC = 0;
const FUND_WALLET = 1; // Wallet where funds are collected
const PAYER_ACC = 2; // Test wallet where all payments are from
const RANDOM_ACC_1 = 3;
const RANDOM_ACC_2 = 4;
const LOCK_ADDRESS = 0;

contract('BitSchoolToken', function (accounts) {
    var token, preSaleStart, preSaleEnd, icoStart, icoEnd;
    var owner = accounts[OWNER_ACC];
    var contribWallet = accounts[FUND_WALLET];

    function resetContract(cb){
        increaseTimeTo(2000).then(function(curTime){
            assert.isTrue(curTime.gt(0), "Current time is not set correctly on contract reset!");
            preSaleStart = curTime.add(DAY);;
            preSaleEnd = preSaleStart.add(4 * WEEK);
            icoStart = preSaleEnd.add(4 * WEEK);
            icoEnd = icoStart.add(4 * WEEK);
            return BitSchoolToken.new(
                preSaleStart,
                preSaleEnd,
                icoStart,
                icoEnd,
                contribWallet,
                {gas:5000000}
            );
        }).then(function(instance){
            token = instance;
            cb();
        }).catch(cb);
    };

    before(resetContract);

    it('should initialize token distribution', function () {
        var totalSupply, familySupply, preicoSupply, publicSupply, totalOther;

        return token.totalSupply.call().then(function (_totalSupply) {
            totalSupply = _totalSupply;
            return token.MAX_PRESALE_SUPPLY.call();
        }).then(function (_preicosupply) {
            preicoSupply = _preicosupply;
            return token.ICO_HARDCAP.call();
        }).then(function (_publicSupply) {
            publicSupply = _publicSupply;
            return token.BITSCHOOL_FAMILY_SUPPLY.call();
        }).then(function (_familySupply) {
            familySupply = _familySupply;
            totalOther = familySupply.add(preicoSupply);
            totalOther = totalOther.add(publicSupply);
            assert.isTrue(totalSupply.gt(0), 'total supply is not greater than 0');
            assert.isTrue(publicSupply.lt(totalSupply), 'public tokens supply exceeds total');
            assert.isTrue(totalOther.lt(totalSupply), 'Total distributed tokens exceeds total supply');
        });
    });

    it('should set the owner', function () {
        return token.owner.call().then(function (_owner) {
            assert.equal(owner, _owner);
        });
    });

    
    it('should ensure that the starting balance of the owner is correct', function () {
        var totalSupply, familyLockAmt, ownerTokens, lockedTokens;

        return token.totalSupply.call().then(function (_totalSupply) {
            totalSupply = _totalSupply;
            return token.BITSCHOOL_FAMILY_SUPPLY.call();
        }).then(function (_familyLockAmt) {
            familyLockAmt = _familyLockAmt;
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokens = _tokens;
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockedTokens = _tokens;

            assert.isTrue(lockedTokens.add(ownerTokens).eq(totalSupply), 'Locked Address + Owner do NOT hold all tokens!');
            assert.isTrue(lockedTokens.eq(familyLockAmt), 'Locked address does NOT hold all the locked tokens!');
            assert.isTrue(totalSupply.sub(familyLockAmt).eq(ownerTokens), 'The owner does NOT hold the expected tokens!');
        });
    });

    

    it('should prevent ownership transfers until ATLEAST 30 days AFTER sale end date ', function () {
        var currentOwner, newOwner = accounts[PAYER_ACC], saleEndDate;
        return token.owner.call().then(function (_owner) {
            currentOwner = _owner;
            assert.notEqual(currentOwner, newOwner, "Current owner is already set to the NEW owner!");
            return token.saleEndTime.call();
        }).then(function (_saleEndDate) {
            saleEndDate = _saleEndDate;
            return getCurTime();
        }).then(function (currentTime) {
            assert.isTrue(currentTime.lt(saleEndDate.add(30 * DAY)), 'Current time is already PAST the allowed transfer date');
            return token.transferOwnership(newOwner, {from: owner}).catch(function () { });
        }).then(function () {
            return token.owner.call();
        }).then(function (_owner) {
            assert.equal(_owner, currentOwner, "New owner was changed BEFORE the allowed transfer date!");
        });
    });

    it('should prevent any transfer of tokens before the end of the sale + 14 days', function () {
        var saleEndTime, tokensBefore, tokensAfter, transferAmount = new Big(100);
        var to_acc = accounts[RANDOM_ACC_1];

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return getCurTime();
        }).then(function (currentTime) {
            assert.isTrue(saleEndTime.add(14*DAY).gt(currentTime), 'The allowed transfer date is NOT in the future');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            assert.isTrue(_tokens.gte(transferAmount), 'Account does NOT have enough tokens to send');
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensBefore = _tokens;
            return token.transfer(to_acc, transferAmount, {from: owner}).catch(function () { });
        }).then(function () {
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensAfter = _tokens;
            assert.isTrue(tokensBefore.eq(tokensAfter), 'Balance was UPDATED incorrectly!');
            assert.isTrue(transferAmount.gt(0), 'Transfer amount is NOT greater than ZERO!');            
        });
    });

    it('should only allow the owner to use transferFrom before the sale end date + 14 days', function () {
        var sender = accounts[RANDOM_ACC_1], to_acc = accounts[RANDOM_ACC_2], from_acc = accounts[RANDOM_ACC_2];
        var toAccTokensBefore, toAccTokensAfter, tokenAllowanceBefore, tokenAllowanceAfter;
        var saleEndTime, transferAmount = new Big(10000);

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return getCurTime();
        }).then(function (currentTime) {
            assert.isTrue(saleEndTime.add(14*DAY).gt(currentTime), 'WARNING: The allowed transfer date is NOT in the future');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            assert.isTrue(_tokens.gt(transferAmount), 'WARNING: Owner does not have enough tokens to send!');
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            toAccTokensBefore = _tokens;
            // This should be allowed as the owner is exempt from the withdrawal time limit
            return token.transferFrom(owner, to_acc, transferAmount, {from: owner});
        }).then(function () {
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            toAccTokensAfter = _tokens;
            assert.isTrue(transferAmount.gt(0), 'WARNING: The amount transfered was NOT greater than 0!');
            assert.isTrue(toAccTokensBefore.add(transferAmount).eq(toAccTokensAfter), 'WARNING: To Account TOKEN balance was not increased correctly!');
            
            // Next check that a normal account CANNOT send using this method.
            to_acc = owner;
            return token.approve(sender, transferAmount, {from: from_acc});
        }).then(function () {
            return token.balanceOf.call(to_acc)
        }).then(function (_tokens) {
            toAccTokensBefore = _tokens;
            return token.allowance.call(from_acc, sender);
        }).then(function (_allowance) {
            tokenAllowanceBefore = _allowance;
            assert.isTrue(tokenAllowanceBefore.eq(transferAmount), 'WARNING: Allowance of sender was not set correctly!');
            return token.transferFrom(from_acc, to_acc, transferAmount, {from: sender}).catch(function () { });
        }).then(function () {
            return token.balanceOf.call(to_acc)
        }).then(function (_tokens) {
            toAccTokensAfter = _tokens;
            return token.allowance.call(from_acc, sender);
        }).then(function (_allowance) {
            tokenAllowanceAfter = _allowance;
            assert.isTrue(tokenAllowanceBefore.eq(tokenAllowanceAfter), 'WARNING: Token allowance changed after transfer!');
            assert.isTrue(toAccTokensBefore.eq(toAccTokensAfter), 'WARNING: To Accounts token balance updated!');
        });
    });

    it('should allow payments and distribute tokens appropriately', function () {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(20000);
        var preSaleStart, coinPrice, tokenAmount;
        var curTime;
        return token.weiBalanceOf.call(payer).then(function(_weiBalance){
            weiBalanceBefore = _weiBalance;
            assert.isTrue(weiBalanceBefore.eq(0), "Payer has greater than 0 contribution before any payments!");
            return token.balanceOf.call(payer);
        }).then(function(_tokensBefore){
            tokensBefore = _tokensBefore;
            assert.isTrue(tokensBefore.eq(0), "Payer already has tokens before any contributions!");
            return token.totalSold.call();
        }).then(function(_totalSold){
            soldBefore = _totalSold;
            assert.isTrue(tokensBefore.eq(0), "Total sold already greater than 0 despite no contributions!");
            return token.preSaleStartTime.call();
        }).then(function(_preSaleStart){
            preSaleStart = _preSaleStart;
            return increaseTimeTo(preSaleStart.add(DAY));
        }).then(function(_curTime) {
            curTime = _curTime;
            assert.isTrue(preSaleStart.lt(curTime), "Current Time is less than pre sale start time!");
            return token.isPreSaleTime.call();
        }).then(function(isPreSaleOn){
            assert.isTrue(isPreSaleOn, "Presale is not currently on!");
            return token.MIN_CONTRIBUTION.call();
        }).then(function(_minContribution){
            amount = _minContribution;
            return token.buyCoins(payer, {from: payer, value: amount});
        }).then(function(){
            return token.weiBalanceOf.call(payer);
        }).then(function(_weiBalanceAfter){
            weiBalanceAfter = _weiBalanceAfter;
            assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore.add(amount)), "Wei balance in account was incorrectly increased ");
            return token.balanceOf.call(payer);
        }).then(function(_tokensAfter){
            tokensAfter = _tokensAfter;
            return token.getCoinPrice();
        }).then(function(_coinPrice){
            coinPrice = _coinPrice;
            return token.calcCoinFromWei(amount, coinPrice);
        }).then(function(_tokenAmount){
            tokenAmount = _tokenAmount;
            assert.isTrue(tokensAfter.eq(tokensBefore.add(tokenAmount)), "Token amount for payer was not increased correctly!");
            return token.totalSold.call();
        }).then(function(_soldAfter){
            soldAfter = _soldAfter;
            assert.isTrue(soldAfter.eq(soldBefore.add(tokenAmount)),"Total sold was not increased correctly!");
        });
    });

    it('should enable normal accounts to set allowance of other accounts', function () {
        var allowanceToSet = 100;

        return token.allowance.call(accounts[PAYER_ACC], accounts[RANDOM_ACC_1]).then(function (allowance) {
            assert.isTrue(allowance.eq(0), 'Current allowance for other wallet is NOT zero!');
            return token.approve(accounts[RANDOM_ACC_1], allowanceToSet, {from: accounts[PAYER_ACC]});
        }).then(function () {
            return token.allowance.call(accounts[PAYER_ACC], accounts[RANDOM_ACC_1]);
        }).then(function (allowance) {
            assert.isTrue(allowance.eq(allowanceToSet), 'The allowance was incorrectly set!');
        });
    });

    it('should enable accounts to change allowance to zero', function () {
        return token.allowance.call(accounts[PAYER_ACC], accounts[RANDOM_ACC_1]).then(function (allowance) {
            assert.isFalse(allowance.eq(0), 'Allowance is currently only at ZERO!');
            return token.approve(accounts[RANDOM_ACC_1], 0, {from: accounts[PAYER_ACC]});
        }).then(function () {
            return token.allowance.call(accounts[PAYER_ACC], accounts[RANDOM_ACC_1]);
        }).then(function (allowance) {
            assert.isTrue(allowance.eq(0), 'Allowance was not correctly set to zero!');
        });
    });


    it('should enable everyone to perform transfers 14 days AFTER sale ends', function () {
        var transferAllowDate, transferAmount = new Big(50), tokensFromBefore, tokensFromAfter;
        var tokensToBefore, tokensToAfter, from_acc = accounts[PAYER_ACC], to_acc = accounts[RANDOM_ACC_1];

        return token.saleEndTime.call().then(function (_saleEndTime) {
            // Increase time to 1 day after transfered allowed date
            transferAllowDate = _saleEndTime.add(14 * DAY);
            return increaseTimeTo(transferAllowDate.add(DAY));
        }).then(function (currentTime) {
            assert.isTrue(currentTime.gt(transferAllowDate), 'WARNING: Time NOT after transfer allow date!');
            return token.balanceOf.call(from_acc);
        }).then(function (_tokens) {
            tokensFromBefore = _tokens;
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToBefore = _tokens;
            return token.transfer(to_acc, transferAmount, {from: from_acc});
        }).then(function () {
            return token.balanceOf.call(from_acc);
        }).then(function (_tokens) {
            tokensFromAfter = _tokens;
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToAfter = _tokens;
            assert.isTrue(tokensFromBefore.eq(tokensFromAfter.add(transferAmount)), 'WARNING: PAYEE ACCOUNT balance was NOT reduced correctly!');
            assert.isTrue(tokensToBefore.eq(tokensToAfter.sub(transferAmount)), 'WARNING: Recipient balance was NOT increased by the correct amount!');
        });
    });

    it('should prevent accounts from spending more than they are allowed to', function () {
        var allowance, tokensToBefore, tokensToAfter, transferAmount = new Big(10000);
        var sender = accounts[RANDOM_ACC_1], to_acc = accounts[RANDOM_ACC_2];

        // Set allowance for sender
        return token.approve(sender, transferAmount.toNumber(), {from: owner}).then(function () {
            // Check allowance has been set
            return token.allowance.call(owner, sender);
        }).then(function (_allowance) {
            allowance = _allowance;
            assert.isTrue(allowance.gt(0), "WARNING: Allowance is NOT greater than 0!");
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToBefore = _tokens;
            return token.transferFrom(owner, to_acc, allowance.add(1), {from: sender}).catch(function () { });
        }).then(function () {
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToAfter = _tokens;
            assert.isTrue(tokensToBefore.eq(tokensToAfter), 'WARNING: Balance has changed incorrectly!');
        });
    });

    // Time should be 14 days after sale end here.
    it('should prevent the owner from spending more than the current balance', function () {
        var ownerTokensBefore, ownerTokensAfter;
        var tokensToBefore, tokensToAfter;
        var to_acc = accounts[RANDOM_ACC_1]

        return token.balanceOf.call(owner).then(function (_tokens) {
            ownerTokensBefore = _tokens;
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToBefore = _tokens;
            var transferAmount = ownerTokensBefore.add(1);
            return token.transfer(to_acc, transferAmount, {from: owner}).catch(function () {});
        }).then(function () {
            return token.balanceOf.call(to_acc);
        }).then(function (_tokens) {
            tokensToAfter = _tokens;
            assert.isTrue(tokensToBefore.eq(tokensToAfter), 'WARNING: To Tokens were INCORRECTLY changed');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensAfter = _tokens;
            assert.isTrue(ownerTokensBefore.eq(ownerTokensAfter), 'WARNING: Owner tokens were INCORRECTLY changed');
        });
    });

    it('should stop the owner from withdrawing the locked amount for bitschool family before lock duration expires', function () {
        var lockTokensBefore, lockTokensAfter, ownerTokensBefore, ownerTokensAfter;
        var saleEndTime, familyLockDura;

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isFalse(_familyWithdrawn, "WARNING: BitSchool Family Withdrawn boolean is TRUE!");
            return token.FAMILY_LOCK_DURA.call();
        }).then(function (_familyLockDura) {
            familyLockDura = _familyLockDura;
            return getCurTime();
        }).then(function (_currentTime) {
            assert.isTrue(_currentTime.lt(saleEndTime.add(familyLockDura)), "WARNING: BitSchool lock time is in the past!");
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensBefore = _tokens;
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensBefore = _tokens;
            return token.unlockFamilyCoins({from: owner});
        }).then(function () {
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensAfter = _tokens;
            assert.isTrue(lockTokensBefore.eq(lockTokensAfter), 'WARNING: The locked address has changed incorrectly!');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensAfter = _tokens;
            assert.isTrue(ownerTokensBefore.eq(ownerTokensAfter), 'WARNING: Owner balanced has changed incorrectly!');
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isFalse(_familyWithdrawn, "WARNING: BitSchool Family Withdrawn boolean is TRUE when it should still be false!");
        });
    });

    // Increases time to the bitschool family withdrawal date.
    it('should stop anyone who is not the owner from withdrawing locked tokens', function () {
        var familyLockDura, saleEndTime, withdrawTime, nonOwner = accounts[RANDOM_ACC_1];
        var lockTokensBefore, lockTokensAfter, ownerTokensBefore, ownerTokensAfter;

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isFalse(_familyWithdrawn, "BitSchool Family Withdrawn boolean is TRUE!");
            return token.FAMILY_LOCK_DURA.call();
        }).then(function (_lock) {
            familyLockDura = _lock;
            withdrawTime = saleEndTime.add(familyLockDura);
            return increaseTimeTo(withdrawTime.add(DAY));
        }).then(function (currentTime) {
            assert.isTrue(currentTime.gte(withdrawTime), 'WARNING: Current time is NOT after withdrawal time');
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensBefore = _tokens;
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensBefore = _tokens;
            assert.notEqual(owner, nonOwner, 'WARNING: Non-Owner account is set to owner!');
            return token.unlockFamilyCoins({from: nonOwner}).catch(function () { });
        }).then(function () {
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isFalse(_familyWithdrawn, 'WARNING: Family Lock boolean set to true!');
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensAfter = _tokens;
            assert.isTrue(lockTokensBefore.eq(lockTokensAfter), 'WARNING: Lock address has changed!');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensAfter = _tokens;
            assert.isTrue(ownerTokensBefore.eq(ownerTokensAfter), 'WARNING: Owner tokens has changed!');
        });
    });

    it('should enable the owner to withdraw all of the bitschool family locked tokens', function () {
        var familyLockDura, saleEndTime, withdrawTime, familySupply;
        var lockTokensBefore, lockTokensAfter, ownerTokensBefore, ownerTokensAfter;

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isFalse(_familyWithdrawn, "WARNING: BitSchool Family Withdrawn boolean is TRUE!");
            return token.FAMILY_LOCK_DURA.call();
        }).then(function (_lock) {
            familyLockDura = _lock;
            withdrawTime = saleEndTime.add(familyLockDura);
            return getCurTime();
        }).then(function (currentTime) {
            assert.isTrue(currentTime.gte(withdrawTime), 'WARNING: Current time is NOT after withdrawal time');
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensBefore = _tokens;
            return token.BITSCHOOL_FAMILY_SUPPLY.call();
        }).then(function (_familySupply) {
            familySupply = _familySupply;
            assert.isTrue(_familySupply.gt(0), 'WARNING: Family supply is NOT greater than 0!');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensBefore = _tokens;
            return token.unlockFamilyCoins({from: owner});
        }).then(function () {
            return token.familyLockWithdrawn.call();
        }).then(function (_familyWithdrawn) {
            assert.isTrue(_familyWithdrawn, "WARNING: Bitschool family withdrawn state still FALSE!");
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensAfter = _tokens;
            assert.isTrue(lockTokensBefore.sub(familySupply).eq(lockTokensAfter), 'WARNING: Bitschool lock addresss for family still has tokens!');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensAfter = _tokens;
            assert.isTrue(ownerTokensBefore.add(familySupply).eq(ownerTokensAfter), 'WARNING: Owner tokens were not increased based on family tokens.');
            // Try to withdraw family tokens again.. should fail
            lockTokensBefore = lockTokensAfter;
            ownerTokensBefore = ownerTokensAfter;
            return token.unlockFamilyCoins({from: owner});
        }).then(function () {
            return token.balanceOf.call(LOCK_ADDRESS);
        }).then(function (_tokens) {
            lockTokensAfter = _tokens;
            assert.isTrue(lockTokensBefore.eq(lockTokensAfter), 'WARNING: Family Lock Address tokens changed!');
            return token.balanceOf.call(owner);
        }).then(function (_tokens) {
            ownerTokensAfter = _tokens;
            assert.isTrue(ownerTokensBefore.eq(ownerTokensAfter), 'WARNING: Owner tokens changed!');
        });
    });

    it('should stop non owners from being able to transfer ownership', function () {
        var saleEndTime, curOwner;
        var newOwner = accounts[RANDOM_ACC_1], notOwner = accounts[RANDOM_ACC_2];

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return token.owner.call();
        }).then(function (_owner) {
            curOwner = _owner;
            assert.notEqual(curOwner, newOwner, "WARNING: The current owner and new possible owner are the same!");
            return getCurTime();
        }).then(function (currentTime) {
            // ensure transfer ownerships are current allowed for this time.
            assert.isTrue(currentTime.gte(saleEndTime.add(DAY*30)), 'WARNING: Ownership transfer time is in the future!');
            assert.notEqual(notOwner, curOwner, 'WARNING: Current owner is equal to address used for non owner');
            return token.transferOwnership(newOwner, {from: notOwner}).catch(function () { });
        }).then(function () {
            return token.owner.call();
        }).then(function (_owner) {
            assert.notEqual(_owner, newOwner, 'WARNING: Owner was changed to new owner incorrectly!');
            assert.equal(_owner, curOwner, 'WARNING: Owner is no longer the current owner!');
        });
    });

    it('should enable owner to transfer ownership 15 days AFTER sale end date', function () {
        var saleEndTime, newOwner = accounts[RANDOM_ACC_2], curOwner;

        return token.saleEndTime.call().then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return token.owner.call();
        }).then(function (_owner) {
            curOwner = _owner;
            assert.notEqual(curOwner, newOwner, 'WARNING: New owner is same as current owner!');
            return getCurTime();
        }).then(function (currentTime) {
            assert.isTrue(currentTime.gte(saleEndTime.add(DAY*30)), 'WARNING: Ownership transfer time is in the future!');
            return token.transferOwnership(newOwner, {from: owner});
        }).then(function () {
            return token.owner.call();
        }).then(function (_owner) {
            assert.equal(_owner, newOwner, 'WARNING: Ownership transfer did not occur correctly!');
            return token.transferOwnership(curOwner, {from: newOwner}); // change back to old owner
        });
    });
    

    it('should reject payments that are BELOW the minimum contribution of 0.01 Ether', function (cb) {
        var payer = accounts[PAYER_ACC], amount = new Big(100);
        var saleStart, curTime;
        var weiBalanceBefore, weiBalanceAfter;
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.saleStartTime.call();
            }).then(function(_saleStart){
                saleStart = _saleStart;
                return increaseTimeTo(saleStart.add(DAY));
            }).then(function(_curTime){
                curTime = _curTime;
                return token.MIN_CONTRIBUTION.call();
            }).then(function(_minContribution){
                assert.isTrue(curTime.gt(saleStart), "Current time is NOT after sale start");
                assert.isTrue(amount.lt(_minContribution), "Wei payment is NOT less than the Minimum amount!");
                return token.buyCoins(payer, {from: payer, value: amount}).catch(function () {});
            }).then(function(){
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore), "Wei contribution that was less than minimum was accepted!");
                cb();
            });
        });
    });

    it('should allow supporters to send ether directly to the contract', function () {

        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(20000);
        var saleStart, coinPrice, tokenAmount;
        var curTime;
        return token.weiBalanceOf.call(payer).then(function(_weiBalance){
            weiBalanceBefore = _weiBalance;
            assert.isTrue(weiBalanceBefore.eq(0), "WARNING: Payer has greater than 0 contribution before any payments!");
            return token.balanceOf.call(payer);
        }).then(function(_tokensBefore){
            tokensBefore = _tokensBefore;
            assert.isTrue(tokensBefore.eq(0), "WARNING: Payer already has tokens before any contributions!");
            return token.totalSold.call();
        }).then(function(_totalSold){
            soldBefore = _totalSold;
            assert.isTrue(tokensBefore.eq(0), "WARNING: Total sold already greater than 0 despite no contributions!");
            return token.saleStartTime.call();
        }).then(function(_saleStart){
            saleStart = _saleStart;
            return getCurTime();
        }).then(function(_curTime) {
            curTime = _curTime;
            assert.isTrue(saleStart.lt(curTime), "WARNING: Current time is not AFTER sale start!");
            return token.isSaleTime.call();
        }).then(function(isSaleOn){
            assert.isTrue(isSaleOn, "WARNING: sale is not currently on!");
            return token.MIN_CONTRIBUTION.call();
        }).then(function(_minContribution){
            amount = _minContribution;
            return token.sendTransaction({from: payer, value: amount});
        }).then(function(){
            return token.weiBalanceOf.call(payer);
        }).then(function(_weiBalanceAfter){
            weiBalanceAfter = _weiBalanceAfter;
            assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore.add(amount)), "WARNING: Wei balance in account was incorrectly increased ");
            return token.balanceOf.call(payer);
        }).then(function(_tokensAfter){
            tokensAfter = _tokensAfter;
            return token.getCoinPrice();
        }).then(function(_coinPrice){
            coinPrice = _coinPrice;
            return token.calcCoinFromWei(amount, coinPrice);
        }).then(function(_tokenAmount){
            tokenAmount = _tokenAmount;
            assert.isTrue(tokensAfter.eq(tokensBefore.add(tokenAmount)), "WARNING: Token amount for payer was not increased correctly!");
            return token.totalSold.call();
        }).then(function(_soldAfter){
            soldAfter = _soldAfter;
            assert.isTrue(soldAfter.eq(soldBefore.add(tokenAmount)),"WARNING: Total sold was not increased correctly!");
        });
    });

    it('should reject payments when the current time is BEFORE the presale start', function (cb) {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(100);
        var preSaleStart, coinPrice, tokenAmount;
        var curTime;
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.balanceOf.call(payer);
            }).then(function(_tokensBefore){
                tokensBefore = _tokensBefore;
                return token.totalSold.call();
            }).then(function(_totalSold){
                soldBefore = _totalSold;
                return token.preSaleStartTime.call();
            }).then(function(_preSaleStart){
                preSaleStart = _preSaleStart;
                return getCurTime();
            }).then(function(_curTime){
                curTime = _curTime;
                assert.isTrue(curTime.lt(preSaleStart), "WARNING: Current Time " + curTime + " is NOT before pre sale start time! " + preSaleStart);
                return token.MIN_CONTRIBUTION.call();
            }).then(function(_minContribution){
                amount = _minContribution;
                return token.buyCoins(payer, {from: payer, value: amount}).catch(function () {});
            }).then(function(){
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore), "WARNING: Wei balance in account was incorrectly increased");
                return token.balanceOf.call(payer);
            }).then(function(_tokensAfter){
                tokensAfter = _tokensAfter;
                return token.getCoinPrice();
            }).then(function(_coinPrice){
                coinPrice = _coinPrice;
                return token.calcCoinFromWei(amount, coinPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                assert.isTrue(tokensAfter.eq(tokensBefore), "Token amount for payer was incorrectly increased!");
                return token.totalSold.call();
            }).then(function(_soldAfter){
                soldAfter = _soldAfter;
                assert.isTrue(soldAfter.eq(soldBefore),"Total sold was incorrectly increased!");
                cb();
            });
        });
    });

    it('should reject payments when the current time is AFTER the presale END but BEFORE the main sale start', function (cb) {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(100);
        var preSaleEnd, saleStart, coinPrice, tokenAmount;
        var curTime;
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.balanceOf.call(payer);
            }).then(function(_tokensBefore){
                tokensBefore = _tokensBefore;
                return token.totalSold.call();
            }).then(function(_totalSold){
                soldBefore = _totalSold;
                return token.preSaleEndTime.call();
            }).then(function(_preSaleEnd){
                preSaleEnd = _preSaleEnd;
                return token.saleStartTime.call();
            }).then(function(_saleStart){
                saleStart = _saleStart;
                return increaseTimeTo(preSaleEnd.add(DAY));
            }).then(function(_curTime){
                curTime = _curTime;
                assert.isTrue(curTime.gt(preSaleEnd), "Current time is NOT after pre sale start");
                assert.isTrue(curTime.lt(saleStart), "Current time is NOT before sale start");
                return token.MIN_CONTRIBUTION.call();
            }).then(function(_minContribution){
                amount = _minContribution;
                return token.buyCoins(payer, {from: payer, value: amount}).catch(function () {});
            }).then(function(){
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore), "Wei balance in account was incorrectly increased");
                return token.balanceOf.call(payer);
            }).then(function(_tokensAfter){
                tokensAfter = _tokensAfter;
                return token.getCoinPrice();
            }).then(function(_coinPrice){
                coinPrice = _coinPrice;
                return token.calcCoinFromWei(amount, coinPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                assert.isTrue(tokensAfter.eq(tokensBefore), "Token amount for payer was incorrectly increased!");
                return token.totalSold.call();
            }).then(function(_soldAfter){
                soldAfter = _soldAfter;
                assert.isTrue(soldAfter.eq(soldBefore),"Total sold was incorrectly increased!");
                cb();
            });
        });
    });

    it('should reject payments when the current time is AFTER the sale has ended based on time', function (cb) {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(100);
        var saleEnd, coinPrice, tokenAmount;
        var curTime;
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.balanceOf.call(payer);
            }).then(function(_tokensBefore){
                tokensBefore = _tokensBefore;
                return token.totalSold.call();
            }).then(function(_totalSold){
                soldBefore = _totalSold;
                return token.saleEndTime.call();
            }).then(function(_saleEnd){
                saleEnd = _saleEnd;
                return increaseTimeTo(saleEnd.add(DAY));
            }).then(function(_curTime){
                curTime = _curTime;
                assert.isTrue(curTime.gt(saleEnd), "Current time is NOT after sale end");
                return token.MIN_CONTRIBUTION.call();
            }).then(function(_minContribution){
                amount = _minContribution;
                return token.buyCoins(payer, {from: payer, value: amount}).catch(function () {});
            }).then(function(){
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore), "Wei balance in account was incorrectly increased");
                return token.balanceOf.call(payer);
            }).then(function(_tokensAfter){
                tokensAfter = _tokensAfter;
                return token.getCoinPrice();
            }).then(function(_coinPrice){
                coinPrice = _coinPrice;
                return token.calcCoinFromWei(amount, coinPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                assert.isTrue(tokensAfter.eq(tokensBefore), "Token amount for payer was incorrectly increased!");
                return token.totalSold.call();
            }).then(function(_soldAfter){
                soldAfter = _soldAfter;
                assert.isTrue(soldAfter.eq(soldBefore),"Total sold was incorrectly increased!");
                cb();
            });
        });
    });

    it('should refund WEI when the amount of contribution exceeds the hard cap of presale', function (cb) {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(100000), excessWei = new Big(10000000000000000000);
        var preSaleStart, coinPrice, tokenAmount, preSaleHardCap, weiHardCap;
        var curTime;
        var payerBalanceBefore, payerBalanceAfter, contribBefore, contribAfter;
        
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.balanceOf.call(payer);
            }).then(function(_tokensBefore){
                tokensBefore = _tokensBefore;
                return token.totalSold.call();
            }).then(function(_totalSold){
                soldBefore = _totalSold;
                return token.MAX_PRESALE_SUPPLY.call();
            }).then(function(_preSaleHardCap){
                preSaleHardCap = _preSaleHardCap;
                return token.preSaleStartTime.call();
            }).then(function(_preSaleStart){
                preSaleStart = _preSaleStart;
                return increaseTimeTo(preSaleStart.add(DAY));
            }).then(function(_curTime){
                curTime = _curTime;
                assert.isTrue(curTime.gt(preSaleStart), "Current time is NOT after sale start!");
                return token.getCoinPrice();
            }).then(function(_coinPrice){
                coinPrice = _coinPrice;
                return web3.eth.getBalance(payer);
            }).then(function(_payerBalanceBefore){
                payerBalanceBefore = _payerBalanceBefore;
                return web3.eth.getBalance(contribWallet);
            }).then(function(_contribBefore){
                contribBefore = _contribBefore;
                // Calculate amount of WEI to contribute to reach hard cap
                return token.calcWeiFromCoin(preSaleHardCap, coinPrice);
            }).then(function(_WeiRequired){
                weiHardCap =_WeiRequired
                amount = weiHardCap.add(excessWei);
                assert.isTrue(amount.gt(weiHardCap), "Amount does NOT exceed hard cap!");
                return token.buyCoins(payer, {from: payer, value: amount});
            }).then(function(){
                return web3.eth.getBalance(payer);
            }).then(function(_payerBalanceAfter){
                payerBalanceAfter = _payerBalanceAfter;
                assert.isTrue(payerBalanceBefore.sub(amount).lt(payerBalanceAfter), "Incorrect WEI amount was refunded to payer! BEFORE: " + payerBalanceBefore + " AFTER: " + payerBalanceAfter);
                return web3.eth.getBalance(contribWallet);
            }).then(function(_contribAfter){
                contribAfter = _contribAfter;
                assert.isTrue(contribBefore.add(weiHardCap).eq(contribAfter), "Contribution Address does not have the correct funds!");
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore.add(weiHardCap)), "Wei balance in account was incorrectly increased");
                return token.balanceOf.call(payer);
            }).then(function(_tokensAfter){
                tokensAfter = _tokensAfter;
                assert.isTrue(tokensAfter.eq(tokensBefore.add(preSaleHardCap)), "Token amount for payer was incorrectly increased! BEFORE: "+ tokensBefore + " AFTER : " +tokensAfter + " WEIHARDCAP: " + weiHardCap + " COIN PRICE: " + coinPrice);
                return token.totalSold.call();
            }).then(function(_soldAfter){
                soldAfter = _soldAfter;
                assert.isTrue(soldAfter.eq(soldBefore.add(preSaleHardCap)),"Total sold was incorrectly increased!");
                cb();
            });
        });
    });

    it('should refund WEI when the amount of contribution exceeds the hard cap of main sale', function (cb) {
        var weiBalanceBefore, weiBalanceAfter, tokensBefore, tokensAfter, soldBefore, soldAfter;
        var payer = accounts[PAYER_ACC], amount = new Big(100000), excessWei = new Big(10000000000000000000);
        var saleStart, coinPrice, tokenAmount, saleHardCap, weiHardCap;
        var curTime;
        var payerBalanceBefore, payerBalanceAfter, contribBefore, contribAfter;
        
        resetContract(function() {
            return token.weiBalanceOf.call(payer).then(function(_weiBalance){
                weiBalanceBefore = _weiBalance;
                return token.balanceOf.call(payer);
            }).then(function(_tokensBefore){
                tokensBefore = _tokensBefore;
                return token.totalSold.call();
            }).then(function(_totalSold){
                soldBefore = _totalSold;
                return token.ICO_HARDCAP.call();
            }).then(function(_saleHardCap){
                saleHardCap = _saleHardCap;
                return token.saleStartTime.call();
            }).then(function(_saleStart){
                saleStart = _saleStart;
                return increaseTimeTo(saleStart.add(DAY));
            }).then(function(_curTime){
                curTime = _curTime;
                assert.isTrue(curTime.gt(saleStart), "Current time is NOT after sale start!");
                return token.getCoinPrice();
            }).then(function(_coinPrice){
                coinPrice = _coinPrice;
                return web3.eth.getBalance(payer);
            }).then(function(_payerBalanceBefore){
                payerBalanceBefore = _payerBalanceBefore;
                return web3.eth.getBalance(contribWallet);
            }).then(function(_contribBefore){
                contribBefore = _contribBefore;
                // Calculate amount of WEI to contribute to reach hard cap
                return token.calcWeiFromCoin(saleHardCap, coinPrice);
            }).then(function(_WeiRequired){
                weiHardCap =_WeiRequired
                amount = weiHardCap.add(excessWei);
                assert.isTrue(amount.gt(weiHardCap), "Amount does NOT exceed hard cap!");
                return token.buyCoins(payer, {from: payer, value: amount});
            }).then(function(){
                return web3.eth.getBalance(payer);
            }).then(function(_payerBalanceAfter){
                payerBalanceAfter = _payerBalanceAfter;
                assert.isTrue(payerBalanceBefore.sub(amount).lt(payerBalanceAfter), "Incorrect WEI amount was refunded to payer! BEFORE: " + payerBalanceBefore + " AFTER: " + payerBalanceAfter);
                return web3.eth.getBalance(contribWallet);
            }).then(function(_contribAfter){
                contribAfter = _contribAfter;
                assert.isTrue(contribBefore.add(weiHardCap).eq(contribAfter), "Contribution Address does not have the correct funds!");
                return token.weiBalanceOf.call(payer);
            }).then(function(_weiBalanceAfter){
                weiBalanceAfter = _weiBalanceAfter;
                assert.isTrue(weiBalanceAfter.eq(weiBalanceBefore.add(weiHardCap)), "Wei balance in account was incorrectly increased");
                return token.balanceOf.call(payer);
            }).then(function(_tokensAfter){
                tokensAfter = _tokensAfter;
                assert.isTrue(tokensAfter.eq(tokensBefore.add(saleHardCap)), "Token amount for payer was incorrectly increased! BEFORE: "+ tokensBefore + " AFTER : " +tokensAfter + " WEIHARDCAP: " + weiHardCap + " COIN PRICE: " + coinPrice);
                return token.totalSold.call();
            }).then(function(_soldAfter){
                soldAfter = _soldAfter;
                assert.isTrue(soldAfter.eq(soldBefore.add(saleHardCap)),"Total sold was incorrectly increased!");
                cb();
            });
        });
    });

    it('should decrease the exchange rate depending on the current week', function (cb) {       
        var preSaleStartTime, saleStartTime, curTime, payer = accounts[PAYER_ACC];
        var amountToBuy, tokensSoldBefore, tokensSoldAfter, tokenPrice, tokenAmount;
        var weekTwo, weekThree, weekFour, saleEnd, preSaleEndTime;
        
        resetContract(function () {
            return token.preSaleStartTime.call().then(function (_preSaleStartTime) {
                preSaleStartTime = _preSaleStartTime;
                return token.preSaleEndTime.call();
            }).then(function(_preSaleEndTime) {
                preSaleEndTime = _preSaleEndTime;
                return token.saleStartTime.call();
            }).then(function(_saleStartTime) {
                
                saleStartTime = _saleStartTime;
                weekTwo = saleStartTime.add(WEEK);
                weekThree = saleStartTime.add(2 * WEEK);
                weekFour = saleStartTime.add(3 * WEEK);
                saleEnd = saleStartTime.add(4 * WEEK);
                return increaseTimeTo(preSaleStartTime.add(DAY));
            }).then(function (_currentTime) {
                curTime = _currentTime;
                assert.isTrue(curTime.gt(preSaleStartTime), "WARNING: Current time is NOT after presale start!"); 
                assert.isTrue(curTime.lt(preSaleEndTime), "WARNING: Current time is NOT BEFORE presale END!"); 
                return token.MIN_CONTRIBUTION.call();
            }).then(function (_amountToBuy) {
                amountToBuy = _amountToBuy;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldBefore = _sold;
                assert.isTrue(tokensSoldBefore.eq(0), 'WARNING: Tokens sold is greater than 0!');
                return token.getCoinPrice();
            }).then(function (_tokenPrice) {
                tokenPrice = _tokenPrice;
                // PRESALE
                return token.PRICE_PRE_ICO.call();
            }).then(function (_preIcoPrice) {
                assert.isTrue(tokenPrice.eq(_preIcoPrice),"WARNING: Current price is NOT correct for presale! Price: " + tokenPrice + " Pre-ICO rate: " + _preIcoPrice);

                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.calcCoinFromWei(amountToBuy, tokenPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldAfter = _sold;
                assert.isTrue(tokensSoldBefore.add(tokenAmount).eq(tokensSoldAfter), 'WARNING: Incorrect tokens sold during presale!');

                // PRESALE END

                return increaseTimeTo(saleStartTime.add(1));
            }).then(function (_currentTime) {
                curTime = _currentTime;
                assert.isTrue(curTime.gt(saleStartTime), "WARNING: Current time is NOT after sale start!"); 
                assert.isTrue(curTime.lt(weekTwo), "WARNING: Current time is NOT before end of week 1!"); 
                tokensSoldBefore = tokensSoldAfter;

                // WEEK 1 START

                return token.getCoinPrice();
            }).then(function (_tokenPrice) {
                tokenPrice = _tokenPrice;
                return token.PRICE_STAGE_ONE.call();
            }).then(function (_weekOnePrice) {
                assert.isTrue(tokenPrice.eq(_weekOnePrice),"WARNING: Current price is NOT correct for week 1!");

                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.calcCoinFromWei(amountToBuy, tokenPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldAfter = _sold;
                assert.isTrue(tokensSoldBefore.add(tokenAmount).eq(tokensSoldAfter), 'WARNING: Incorrect tokens sold during week 1!');

                // WEEK 1 END
                return increaseTimeTo(weekTwo.add(1));
            }).then(function (_currentTime) {
                curTime = _currentTime;
                assert.isTrue(curTime.gt(weekTwo), "WARNING: Current time is NOT after start of week 2!"); 
                assert.isTrue(curTime.lt(weekThree), "WARNING: Current time is NOT before end of week 2!"); 
                tokensSoldBefore = tokensSoldAfter;

                // WEEK 2 START

                return token.getCoinPrice();
            }).then(function (_tokenPrice) {
                tokenPrice = _tokenPrice;
                return token.PRICE_STAGE_TWO.call();
            }).then(function (_weekTwoPrice) {
                assert.isTrue(tokenPrice.eq(_weekTwoPrice),"WARNING: Current price is NOT correct for week 2!");

                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.calcCoinFromWei(amountToBuy, tokenPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldAfter = _sold;
                assert.isTrue(tokensSoldBefore.add(tokenAmount).eq(tokensSoldAfter), 'WARNING: Incorrect tokens sold during week 2!');

                // WEEK 2 END
                return increaseTimeTo(weekThree.add(1));
            }).then(function (_currentTime) {
                curTime = _currentTime;
                assert.isTrue(curTime.gt(weekThree), "WARNING: Current time is NOT after start of week 3!"); 
                assert.isTrue(curTime.lt(weekFour), "WARNING: Current time is NOT before end of week 3!"); 
                tokensSoldBefore = tokensSoldAfter;

                // WEEK 3 START
                return token.getCoinPrice();
            }).then(function (_tokenPrice) {
                tokenPrice = _tokenPrice;
                return token.PRICE_STAGE_THREE.call();
            }).then(function (_weekThreePrice) {
                assert.isTrue(tokenPrice.eq(_weekThreePrice),"WARNING: Current price is NOT correct for week 3!");

                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.calcCoinFromWei(amountToBuy, tokenPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldAfter = _sold;
                assert.isTrue(tokensSoldBefore.add(tokenAmount).eq(tokensSoldAfter), 'WARNING: Incorrect tokens sold during week 3!');

                // WEEK 3 END
                return increaseTimeTo(weekFour.add(1));
            }).then(function (_currentTime) {
                curTime = _currentTime;
                assert.isTrue(curTime.gt(weekFour), "WARNING: Current time is NOT after start of week 4!"); 
                assert.isTrue(curTime.lt(saleEnd), "WARNING: Current time is NOT before end of week 4!"); 
                tokensSoldBefore = tokensSoldAfter;

                // WEEK 4 START

                return token.getCoinPrice();
            }).then(function (_tokenPrice) {
                tokenPrice = _tokenPrice;
                return token.PRICE_STAGE_FOUR.call();
            }).then(function (_weekFourPrice) {
                assert.isTrue(tokenPrice.eq(_weekFourPrice),"WARNING: Current price is NOT correct for week 4!");

                return token.ICO_SOFTCAP.call();
            }).then(function (_softCap) {
                return token.calcWeiFromCoin(_softCap, tokenPrice);
            }).then(function(_weiAmount){
                amountToBuy = _weiAmount;
                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.calcCoinFromWei(amountToBuy, tokenPrice);
            }).then(function(_tokenAmount){
                tokenAmount = _tokenAmount;
                return token.totalSold.call();
            }).then(function (_sold) {
                tokensSoldAfter = _sold;               
                assert.isTrue(tokensSoldBefore.add(tokenAmount).eq(tokensSoldAfter), 'WARNING: Incorrect tokens sold during week 4!');

                // WEEK 4 END
                cb();
            });
        });
    });

    it('should NOT allow the wallet to send funds to the token for a refund IF soft cap is reached', function () {
        var contribWalletWeiBefore = web3.eth.getBalance(contribWallet), contractWeiBefore = web3.eth.getBalance(token.address);
        var contractWeiAfter, softCap, totalSold, saleEndTime, weiRaised;
        var amountToBuy = new Big(100), payer = accounts[PAYER_ACC];
        
        return token.ICO_SOFTCAP.call().then(function (_softCap) {
            softCap = _softCap;
            assert.isTrue(contractWeiBefore.eq(0), 'WARNING: WEI balance of contract is not 0!');
            return token.totalSold.call();
        }).then(function (_totalSold) {
            totalSold = _totalSold;
            assert.isTrue(totalSold.gte(softCap), 'WARNING: The number of sold tokens is less than the soft cap!');
            return token.totalWei.call();
        }).then(function (_totalWei) {
            weiRaised = _totalWei;
            assert.isTrue(contribWalletWeiBefore.gt(weiRaised),"WARNING: Not enough funds in contribution wallet!");
            return token.saleEndTime.call();
        }).then(function (_saleEndTime) {
            saleEndTime = _saleEndTime;
            return increaseTimeTo(saleEndTime.add(DAY));
        }).then(function (_curTime) {
            assert.isTrue(_curTime.gt(saleEndTime),"WARNING: Current time is less than sale end!");
            return token.sendTransaction({from: contribWallet, value: weiRaised}).catch(function () { });
        }).then(function () {
            contractWeiAfter = web3.eth.getBalance(token.address);
            assert.isTrue(contractWeiAfter.eq(contractWeiBefore), 'WARNING: Contract accepted funds');
        });
    });

    it('should prevent the contribution wallet from sending funds DURING the crowdsale', function (cb) {
        var contribWalletWeiBefore = web3.eth.getBalance(contribWallet), contractWeiBefore = web3.eth.getBalance(token.address);
        var contractWeiAfter, softCap, totalSold, saleEndTime, weiRaised;
        var amountToBuy = new Big(100), payer = accounts[PAYER_ACC];

        resetContract(function () {
            return token.ICO_SOFTCAP.call().then(function (_softCap) {
                softCap = _softCap;
                assert.isTrue(contractWeiBefore.eq(0), 'WARNING: WEI balance of contract is not 0!');
                return token.saleStartTime.call();
            }).then(function (_saleStartTime) {
                return increaseTimeTo(_saleStartTime.add(1));
            }).then(function (_currentTime) {
                return token.MIN_CONTRIBUTION.call();
            }).then(function (_minAmount) {
                amountToBuy = _minAmount * 5;
                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.totalSold.call();
            }).then(function (_totalSold) {
                totalSold = _totalSold;
                assert.isTrue(totalSold.lt(softCap), 'WARNING: The number of sold tokens is more than the soft cap!');
                return token.saleEndTime.call();
            }).then(function (_saleEndTime) {
                saleEndTime = _saleEndTime;
                return getCurTime();
            }).then(function (_curTime) {
                assert.isTrue(_curTime.lt(saleEndTime), "WARNING: The current time is past the sale end date!");
                return token.totalWei.call();
            }).then(function (_totalWei) {
                weiRaised = _totalWei;
                assert.isTrue(contribWalletWeiBefore.gt(weiRaised),"WARNING: Not enough funds in contribution wallet!");
    
                return token.sendTransaction({from: contribWallet, value: weiRaised}).catch(function () { });
            }).then(function () {
                contractWeiAfter = web3.eth.getBalance(token.address);
                assert.isTrue(contractWeiAfter.eq(contractWeiBefore), 'WARNING: Contract accepted funds');
                cb();
            });
        });
    });

    it('should allow contribution wallet to send funds to contract if softcap is not reached', function (cb) {
        var contribWalletWeiBefore = web3.eth.getBalance(contribWallet), contractWeiBefore = web3.eth.getBalance(token.address);
        var contractWeiAfter, softCap, totalSold, saleEndTime, weiRaised, contribWalletWeiAfter;
        var amountToBuy = new Big(100), payer = accounts[PAYER_ACC];
        
        resetContract(function () {
            return token.ICO_SOFTCAP.call().then(function (_softCap) {
                softCap = _softCap;
                assert.isTrue(contractWeiBefore.eq(0), 'WARNING: WEI balance of contract is not 0!');
                return token.saleStartTime.call();
            }).then(function (_saleStartTime) {
                return increaseTimeTo(_saleStartTime.add(1));
            }).then(function (_currentTime) {
                return token.MIN_CONTRIBUTION.call();
            }).then(function (_minAmount) {
                amountToBuy = _minAmount * 5;
                return token.buyCoins(payer, {from: payer, value: amountToBuy});
            }).then(function () {
                return token.totalWei.call();
            }).then(function (_totalWei) {
                weiRaised = _totalWei;
                assert.isTrue(contribWalletWeiBefore.gt(weiRaised),"WARNING: Not enough funds in contribution wallet!");
                return token.totalSold.call();
            }).then(function (_totalSold) {
                assert.isTrue(softCap.gt(_totalSold), "WARNING: Softcap has already been reached!");
                assert.isTrue(contractWeiBefore.eq(0), 'WARNING: WEI balance of contract is not 0!');
                return token.saleEndTime.call();
            }).then(function (_saleEndTime) {
                saleEndTime = _saleEndTime;
                return increaseTimeTo(_saleEndTime.add(DAY));
            }).then(function (_currentTime) {
                assert.isTrue(_currentTime.gt(saleEndTime), "WARNING: Current time is not greater than sale end!");
                return token.sendTransaction({from: contribWallet, value: weiRaised});
            }).then(function () {
                contractWeiAfter = web3.eth.getBalance(token.address);
                contribWalletWeiAfter = web3.eth.getBalance(contribWallet);
                assert.isTrue(contribWalletWeiBefore.gt(contribWalletWeiAfter), 'WARNING: Contribution Wallet was NOT reduced');
                assert.isTrue(contractWeiAfter.eq(weiRaised), 'WARNING: Contract WEI is NOT set correctly!');
                cb();
            });
        });
    });

    it('should allow supporters to request a refund if softcap was not reached', function () {
        var totalSold, softCap, saleEndTime, curTime;
        var payer = accounts[PAYER_ACC], payerICOWeiBefore, payerICOWeiAfter;
        var payerWeiBalanceBefore, payerWeiBalanceAfter;
        var contractWeiBefore, contractWeiAfter;

        return token.totalSold.call().then(function (_totalSold) {
            totalSold = _totalSold;
            return token.ICO_SOFTCAP.call();
        }).then(function (_softCap) {
            softCap = _softCap;
            assert.isTrue(totalSold.lt(softCap), 'WARNING: Softcap already exceeded!');
            return token.saleEndTime.call();
        }).then(function(_saleEndTime) {
            saleEndTime = _saleEndTime;
            return getCurTime();
        }).then(function(_curTime) {
            curTime = _curTime;
            assert.isTrue(curTime.gt(saleEndTime), 'WARNING: Sale has not yet fully ended!');
            return token.weiBalanceOf.call(payer);
        }).then(function(_balance){
        	payerICOWeiBefore = _balance;
            payerWeiBalanceBefore = web3.eth.getBalance(payer);
            contractWeiBefore = web3.eth.getBalance(token.address);
            assert.isTrue(payerICOWeiBefore.gt(0), 'WARNING: Selected test account did not send any WEI');
            assert.isTrue(contractWeiBefore.gte(payerICOWeiBefore), 'WARNING: Contract does not contain enough WEI for refund!');
            return token.claimRefund({from: payer});
        }).then(function(){
        	payerWeiBalanceAfter = web3.eth.getBalance(payer);
            contractWeiAfter = web3.eth.getBalance(token.address);
        	assert.isTrue(payerWeiBalanceAfter.gt(payerWeiBalanceBefore), 'WARNING: Payer WEI account did not increase after refund!');
        	assert.isTrue(contractWeiBefore.sub(payerICOWeiBefore).eq(contractWeiAfter), 'WARNING: Incorrect amount of WEI was sent from contract!');
        	return token.weiBalanceOf.call(payer);
        }).then(function (_balance) {
            payerICOWeiAfter = _balance;
            assert.isTrue(payerICOWeiAfter.eq(0), 'WARNING: ICO Payer WEI Balance did not reset to 0!');
        });
    });
});


function web3Send(req){
    web3.currentProvider.send(req);
}

function web3ReqGet(method, arg) {
    var req = {
        jsonrpc: "2.0",
        method: method,
        id: new Date().getTime()
    };
    if (arg) req.params = arg;
    return req;
}

function increaseTime(time) {
    return new Promise((resolve, reject) => {
        try 
        {
            web3Send(web3ReqGet('evm_increaseTime', [time.toNumber()]));
            web3Send(web3ReqGet('evm_mine'));
            resolve(getCurTimeNoPromise());
        } catch (e) {
            console.error(e);
            reject(e);
        }
    });
}

function increaseTimeTo (time) {
    var curTime = getCurTimeNoPromise();
    time = new Big(time);
    var incBy = time.sub(curTime).add(1);
    if(incBy < 0) {
        incBy = time;
    }
    return increaseTime(incBy);
}

function getCurTime() {
    return new Promise(function (resolve) {
        resolve(getCurTimeNoPromise());
    });
}


function getCurTimeNoPromise() {
    return new Big(web3.eth.getBlock(web3.eth.blockNumber).timestamp);
}
