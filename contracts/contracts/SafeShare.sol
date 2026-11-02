// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SafeShare: lend and borrow emergency equipment with rules nobody can quietly change.
/// Mirrors the web app: verified members, credits as deposits, borrow lifecycle,
/// trust score, disputes, emergency pause and blacklist.
/// Test it in Remix with "Remix VM" (no Hardhat needed): the deployer becomes the admin.
contract SafeShare {
    enum Status { Pending, Verified, Blacklisted }
    enum LoanStatus { None, Requested, Approved, Out, Returned, Rejected, Disputed, Resolved }

    struct Member {
        Status status;
        uint256 clean;      // on-time, undamaged returns
        uint256 late;
        uint256 damaged;
        uint256 lost;       // disputes lost (borrower got < 50% of deposit back)
        uint256 lends;      // completed lends as owner
        uint256 careSum;    // sum of owners' care ratings (1-5)
        uint256 careCount;
    }
    struct Item {
        address owner;
        bytes32 fingerprint; // hash of details + photo, computed off-chain
        uint8 condition;     // 1-5
        uint256 deposit;
    }
    struct Loan {
        uint256 itemId;
        address borrower;
        address owner;
        uint256 hrs;
        LoanStatus status;
        uint256 dueAt;
        uint8 condOut;
    }

    uint256 public constant START_CREDITS = 100;

    address public admin;
    bool public paused;
    uint256 public itemCount;
    uint256 public loanCount;

    mapping(address => Member) public members;
    mapping(address => uint256) public credits;
    mapping(uint256 => Item) public items;
    mapping(uint256 => Loan) public loans;
    mapping(uint256 => uint256) public activeLoan; // itemId => loanId (0 = free)

    event Verified(address indexed member);
    event Blacklisted(address indexed member, bool on);
    event Paused(bool on);
    event ItemListed(uint256 indexed itemId, address indexed owner, bytes32 fingerprint, uint8 condition, uint256 deposit);
    event Requested(uint256 indexed loanId, uint256 indexed itemId, address indexed borrower, uint256 hrs);
    event Approved(uint256 indexed loanId);
    event Rejected(uint256 indexed loanId);
    event HandedOver(uint256 indexed loanId, uint8 condition);
    event Returned(uint256 indexed loanId, uint8 condition, uint256 refunded, uint256 kept, bool late);
    event Disputed(uint256 indexed loanId, address by);
    event Resolved(uint256 indexed loanId, uint256 refundPct);

    modifier onlyAdmin() { require(msg.sender == admin, "Admin only"); _; }
    modifier whenActive() { require(!paused, "Paused"); _; }
    modifier onlyVerified() {
        require(members[msg.sender].status != Status.Blacklisted, "Blacklisted");
        require(members[msg.sender].status == Status.Verified, "Not verified");
        _;
    }

    constructor() {
        admin = msg.sender;
        members[msg.sender].status = Status.Verified;
    }

    // ---------------------------------------------------------------- admin
    function verify(address m) external onlyAdmin {
        require(members[m].status == Status.Pending, "Not pending");
        members[m].status = Status.Verified;
        credits[m] += START_CREDITS;
        emit Verified(m);
    }

    function setBlacklist(address m, bool on) external onlyAdmin {
        require(m != admin, "Cannot blacklist admin");
        members[m].status = on ? Status.Blacklisted : Status.Pending;
        emit Blacklisted(m, on);
    }

    function setPaused(bool on) external onlyAdmin {
        paused = on;
        emit Paused(on);
    }

    // ---------------------------------------------------------------- items
    function listItem(bytes32 fingerprint, uint8 condition, uint256 deposit) external whenActive onlyVerified returns (uint256 id) {
        require(condition >= 1 && condition <= 5, "Condition 1-5");
        id = ++itemCount;
        items[id] = Item(msg.sender, fingerprint, condition, deposit);
        emit ItemListed(id, msg.sender, fingerprint, condition, deposit);
    }

    // ---------------------------------------------------------------- borrow flow
    function requestBorrow(uint256 itemId, uint256 hrs) external whenActive onlyVerified returns (uint256 id) {
        Item storage it = items[itemId];
        require(it.owner != address(0), "No such item");
        require(it.owner != msg.sender, "Owner cannot borrow own item");
        require(hrs >= 1 && hrs <= 168, "Hours 1-168");
        require(activeLoan[itemId] == 0, "Item not available");
        require(credits[msg.sender] >= it.deposit, "Not enough credits");
        id = ++loanCount;
        loans[id] = Loan(itemId, msg.sender, it.owner, hrs, LoanStatus.Requested, 0, 0);
        emit Requested(id, itemId, msg.sender, hrs);
    }

    function approve(uint256 loanId) external whenActive {
        Loan storage l = loans[loanId];
        require(l.owner == msg.sender, "Only owner");
        require(l.status == LoanStatus.Requested, "Not open");
        require(activeLoan[l.itemId] == 0, "Already promised");
        l.status = LoanStatus.Approved;
        activeLoan[l.itemId] = loanId;
        emit Approved(loanId);
    }

    function reject(uint256 loanId) external whenActive {
        Loan storage l = loans[loanId];
        require(l.owner == msg.sender, "Only owner");
        require(l.status == LoanStatus.Requested, "Not open");
        l.status = LoanStatus.Rejected;
        emit Rejected(loanId);
    }

    /// Owner confirms the physical handover (the web app proves it with a signed, expiring QR code).
    function handover(uint256 loanId, uint8 condition) external whenActive {
        Loan storage l = loans[loanId];
        Item storage it = items[l.itemId];
        require(l.owner == msg.sender, "Only owner");
        require(l.status == LoanStatus.Approved, "Not approved");
        require(condition >= 1 && condition <= 5, "Condition 1-5");
        require(members[l.borrower].status == Status.Verified, "Borrower not verified");
        require(credits[l.borrower] >= it.deposit, "Not enough credits");
        credits[l.borrower] -= it.deposit; // deposit is held by the contract
        l.status = LoanStatus.Out;
        l.dueAt = block.timestamp + l.hrs * 1 hours;
        l.condOut = condition;
        emit HandedOver(loanId, condition);
    }

    /// Owner confirms the return: late => 20% of deposit kept, each lost condition point => 25%.
    function returnItem(uint256 loanId, uint8 condition, uint8 care) external whenActive {
        Loan storage l = loans[loanId];
        Item storage it = items[l.itemId];
        require(l.owner == msg.sender, "Only owner");
        require(l.status == LoanStatus.Out, "Not checked out");
        require(condition >= 1 && condition <= 5 && care >= 1 && care <= 5, "Ratings 1-5");

        bool late = block.timestamp > l.dueAt;
        uint256 drop = l.condOut > condition ? l.condOut - condition : 0;
        uint256 pct = (late ? 20 : 0) + drop * 25;
        if (pct > 100) pct = 100;
        uint256 kept = (it.deposit * pct) / 100;
        uint256 refunded = it.deposit - kept;

        credits[l.borrower] += refunded;
        credits[l.owner] += kept;
        l.status = LoanStatus.Returned;
        activeLoan[l.itemId] = 0;

        Member storage b = members[l.borrower];
        if (late) b.late++;
        if (drop > 0) b.damaged++;
        if (!late && drop == 0) b.clean++;
        b.careSum += care;
        b.careCount++;
        members[l.owner].lends++;
        emit Returned(loanId, condition, refunded, kept, late);
    }

    // ---------------------------------------------------------------- disputes
    function dispute(uint256 loanId) external whenActive {
        Loan storage l = loans[loanId];
        require(msg.sender == l.owner || msg.sender == l.borrower, "Not a party");
        require(l.status == LoanStatus.Out, "Not checked out");
        l.status = LoanStatus.Disputed;
        emit Disputed(loanId, msg.sender);
    }

    /// Admin decides what share (0-100) of the deposit goes back to the borrower.
    function resolve(uint256 loanId, uint256 refundPct) external onlyAdmin {
        Loan storage l = loans[loanId];
        require(l.status == LoanStatus.Disputed, "Not in dispute");
        require(refundPct <= 100, "0-100");
        uint256 dep = items[l.itemId].deposit;
        uint256 back = (dep * refundPct) / 100;
        credits[l.borrower] += back;
        credits[l.owner] += dep - back;
        l.status = LoanStatus.Resolved;
        activeLoan[l.itemId] = 0;
        if (refundPct < 50) members[l.borrower].lost++;
        members[l.owner].lends++;
        emit Resolved(loanId, refundPct);
    }

    // ---------------------------------------------------------------- views
    function stats(address a) external view returns (uint256 clean, uint256 late, uint256 damaged, uint256 lost, uint256 lends, uint256 careSum, uint256 careCount) {
        Member storage m = members[a];
        return (m.clean, m.late, m.damaged, m.lost, m.lends, m.careSum, m.careCount);
    }

    /// 0-100, anyone can recompute it from the stats above.
    function trustScore(address a) public view returns (uint256) {
        Member storage m = members[a];
        int256 s = 50 + int256(m.clean) * 8 - int256(m.late) * 10 - int256(m.damaged) * 15 - int256(m.lost) * 25;
        uint256 bonus = m.lends * 3;
        s += int256(bonus > 15 ? 15 : bonus);
        if (m.careCount > 0) s += int256((m.careSum * 5) / m.careCount) - 15;
        if (s < 0) return 0;
        if (s > 100) return 100;
        return uint256(s);
    }
}
