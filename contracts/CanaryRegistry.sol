// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev ERC-165 interface detection. The Chainlink KeystoneForwarder checks this before delivering a report.
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @dev The receiver interface Chainlink CRE's forwarder calls (same shape as the CRE docs' IReceiver).
///      https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title CanaryRegistry
/// @notice Public, tamper-evident record of crypto pump-and-dump cases watched by Canary.
///
///  Three ways data gets in:
///   1. Chainlink CRE workflow "canary-watch" -> KeystoneForwarder -> onReport():
///        - alert reports    (a token is being pushed by several promoters: level 1..3)
///        - collapse reports (the token's liquidity was pulled / crashed)
///   2. Chainlink CRE workflow "canary-claims" -> KeystoneForwarder -> onReport():
///        - claim-verified reports: the Chainlink network read Ethereum mainnet and confirmed that the
///          victim's wallet bought the token from its trading pool during the class period. The claim is
///          anchored (if it wasn't already) and the verification is recorded next to it. The wallet itself
///          never goes on-chain: only walletRef = keccak256(abi.encodePacked(walletSalt, wallet)).
///   3. The Canary hotline relayer -> anchorClaim():
///        - the SHA-256 of a victim's evidence file, plus a salted hash that points to the
///          claimant in Canary's private database. No personal data ever goes on-chain.
///   4. Chainlink CRE workflow "canary-anchor" (EVM log trigger on ClaimAnchored) -> onReport():
///        - claim-custody reports: the chain-of-custody record for an anchored claim. It freezes which
///          version of the case the claim relies on (level, reasoning-trail head, collapse yes/no, whether
///          the purchase was verified) and adds the token pool's liquidity on Ethereum mainnet at a named
///          block, read by the Chainlink network when the claim was filed. Later alerts overwrite the
///          case's trailHash; this record keeps the one each claim was filed against.
///
///  Reports are idempotent: the cron workflow can send the same alert many times and only the
///  first one (or a higher level / new reasoning trail) is recorded. That way a retry from the
///  forwarder never reverts and never double-counts.
contract CanaryRegistry is IReceiver {
    // ------------------------------------------------------------------
    // Report format (must match cre/canary-watch/workflow.ts)
    //   report = abi.encode(uint8 kind, bytes body)
    //   kind 1 (alert):    body = abi.encode(bytes32 caseId, string symbol, address token,
    //                                        uint8 level, uint32 promoters, bytes32 trailHash)
    //   kind 2 (collapse): body = abi.encode(bytes32 caseId, address token, uint256 liquidityBefore,
    //                                        uint256 liquidityNow, uint16 dropBps)
    //   kind 3 (claim verified, cre/canary-claims/workflow.ts):
    //                      body = abi.encode(bytes32 caseId, bytes32 evidenceHash, bytes32 claimantRef,
    //                                        bytes32 walletRef, uint32 purchases, uint64 firstBuyBlock)
    //   kind 4 (claim custody, cre/canary-anchor/workflow.ts):
    //                      body = abi.encode(bytes32 caseId, bytes32 evidenceHash, bytes32 anchorTx,
    //                                        uint64 anchorBlock, uint8 level, bytes32 trailHash, bool collapsed,
    //                                        uint32 verifiedPurchases, uint256 poolLiquidityCents, uint64 mainnetBlock)
    //   Liquidity amounts are in US cents (USD * 100).
    // ------------------------------------------------------------------
    uint8 public constant REPORT_ALERT = 1;
    uint8 public constant REPORT_COLLAPSE = 2;
    uint8 public constant REPORT_CLAIM_VERIFIED = 3;
    uint8 public constant REPORT_CLAIM_CUSTODY = 4;

    uint8 public constant LEVEL_SUSPICIOUS = 1;
    uint8 public constant LEVEL_PUMP_AND_DUMP = 2;
    uint8 public constant LEVEL_COLLAPSED = 3;

    /// @notice Everything known about one case, in one struct (what the app and judges read).
    struct CaseStatus {
        string symbol;
        address token;
        uint8 level; // highest level reached: 1 suspicious, 2 pump-and-dump, 3 collapsed (never goes down)
        uint32 promoters; // how many promoters were pushing the token at the last alert
        bytes32 trailHash; // head of the agents' hash-chained reasoning trail at the last alert
        uint64 alertAt; // time of the last recorded alert (0 = never)
        uint256 liquidityBefore; // US cents, at collapse
        uint256 liquidityNow; // US cents, at collapse
        uint16 dropBps; // liquidity drop in basis points (8000 = 80%)
        uint64 collapsedAt; // 0 = not collapsed
        uint32 claimCount; // number of victim claims anchored for this case
    }

    /// @notice What the Chainlink network confirmed about one claim (all zero if not verified).
    struct ClaimVerification {
        bytes32 claimantRef; // salted claimant hash (same meaning as in anchorClaim)
        bytes32 walletRef; // keccak256(abi.encodePacked(walletSalt, wallet)); the wallet is never stored
        uint32 purchases; // buys from the token's pool confirmed on Ethereum mainnet, inside the class period
        uint64 firstBuyBlock; // Ethereum mainnet block of the earliest confirmed buy
        uint64 at; // time recorded (0 = not verified)
    }

    /// @notice Chain-of-custody for one anchored claim, written by the canary-anchor workflow (all zero if none).
    ///         "When this evidence was anchored, the case it relies on stood here."
    struct ClaimCustody {
        bytes32 anchorTx; // Sepolia transaction that emitted ClaimAnchored for this evidence file
        uint64 anchorBlock; // Sepolia block of that transaction
        uint8 level; // the case's level when the claim was filed (0 = no alert recorded yet)
        bytes32 trailHash; // head of the agents' reasoning trail the claim was filed against
        bool collapsed; // was a collapse already recorded?
        uint32 verifiedPurchases; // buys the canary-claims workflow had confirmed (0 = not verified)
        uint256 poolLiquidityCents; // the token's pool on Ethereum mainnet, US cents (0 = not checked)
        uint64 mainnetBlock; // Ethereum mainnet block of that reading (0 = not checked)
        uint64 at; // time recorded (0 = no custody record)
    }

    /// @dev The kind-4 report body, decoded in one go (a struct keeps the stack small).
    struct CustodyReport {
        bytes32 caseId;
        bytes32 evidenceHash;
        bytes32 anchorTx;
        uint64 anchorBlock;
        uint8 level;
        bytes32 trailHash;
        bool collapsed;
        uint32 verifiedPurchases;
        uint256 poolLiquidityCents;
        uint64 mainnetBlock;
    }

    // ------------------------------------------------------------------
    // Events (the public record)
    // ------------------------------------------------------------------
    event AlertRecorded(
        bytes32 indexed caseId,
        string symbol,
        address indexed token,
        uint8 level,
        uint32 promoters,
        bytes32 trailHash,
        uint64 at
    );
    event CollapseRecorded(
        bytes32 indexed caseId,
        address indexed token,
        uint256 liquidityBefore,
        uint256 liquidityNow,
        uint16 dropBps,
        uint64 at
    );
    event ClaimAnchored(bytes32 indexed caseId, bytes32 indexed evidenceHash, bytes32 claimantRef, uint64 at);
    event ClaimVerified(
        bytes32 indexed caseId,
        bytes32 indexed evidenceHash,
        bytes32 claimantRef,
        uint32 purchases,
        uint64 firstBuyBlock,
        uint64 at
    );
    event ClaimCustodyRecorded(
        bytes32 indexed caseId,
        bytes32 indexed evidenceHash,
        bytes32 anchorTx,
        bytes32 trailHash,
        uint8 level,
        uint256 poolLiquidityCents,
        uint64 mainnetBlock,
        uint64 at
    );

    event ForwarderSet(address indexed forwarder, bool allowed);
    event RelayerSet(address indexed relayer, bool allowed);
    event ExpectedWorkflowSet(bytes32 workflowId, address workflowOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error NotOwner();
    error NotPendingOwner();
    error NotForwarder(address sender);
    error NotRelayer(address sender);
    error ZeroAddress();
    error InvalidCaseId();
    error InvalidLevel(uint8 level);
    error InvalidDrop(uint16 dropBps);
    error InvalidEvidenceHash();
    error UnknownReportKind(uint8 kind);
    error WrongWorkflow(bytes32 workflowId, address workflowOwner);
    error ClaimAlreadyAnchored(bytes32 caseId, bytes32 evidenceHash);
    error NoVerifiedPurchases();
    error ClaimNotAnchored(bytes32 caseId, bytes32 evidenceHash);

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    address public owner;
    address public pendingOwner;

    /// @notice Chainlink forwarders allowed to call onReport (allow-list; see deploy.mts for addresses).
    mapping(address => bool) public isForwarder;
    /// @notice Addresses allowed to anchor victim claims (the hotline's relayer). The owner is always allowed.
    mapping(address => bool) public isRelayer;

    /// @notice Optional extra checks on the report metadata (0 = off). Leave off while simulating:
    ///         the simulator's MockForwarder does not supply workflow metadata.
    bytes32 public expectedWorkflowId;
    address public expectedWorkflowOwner;

    mapping(bytes32 => CaseStatus) private _cases;
    bytes32[] private _caseIds;
    /// @notice caseId => evidenceHash => time anchored (0 = not anchored).
    mapping(bytes32 => mapping(bytes32 => uint64)) public claimAnchoredAt;
    /// @notice caseId => evidenceHash => what the canary-claims workflow confirmed.
    mapping(bytes32 => mapping(bytes32 => ClaimVerification)) private _verifications;
    /// @notice caseId => number of claims verified on-chain by the canary-claims workflow.
    mapping(bytes32 => uint32) public verifiedClaimCount;
    /// @notice caseId => evidenceHash => the chain-of-custody record from the canary-anchor workflow.
    mapping(bytes32 => mapping(bytes32 => ClaimCustody)) private _custody;

    // ------------------------------------------------------------------
    // Setup / admin
    // ------------------------------------------------------------------
    constructor(address[] memory forwarders, address relayer) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        for (uint256 i = 0; i < forwarders.length; i++) {
            _setForwarder(forwarders[i], true);
        }
        if (relayer != address(0)) {
            isRelayer[relayer] = true;
            emit RelayerSet(relayer, true);
        }
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setForwarder(address forwarder, bool allowed) external onlyOwner {
        _setForwarder(forwarder, allowed);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        isRelayer[relayer] = allowed;
        emit RelayerSet(relayer, allowed);
    }

    /// @notice Pin reports to one deployed workflow (id from `cre workflow hash`) and/or owner. 0 disables a check.
    function setExpectedWorkflow(bytes32 workflowId, address workflowOwner) external onlyOwner {
        expectedWorkflowId = workflowId;
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowSet(workflowId, workflowOwner);
    }

    /// @notice Two-step ownership transfer, so a typo can't brick the contract.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function _setForwarder(address forwarder, bool allowed) private {
        if (forwarder == address(0)) revert ZeroAddress();
        isForwarder[forwarder] = allowed;
        emit ForwarderSet(forwarder, allowed);
    }

    // ------------------------------------------------------------------
    // Chainlink CRE entry point
    // ------------------------------------------------------------------
    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (!isForwarder[msg.sender]) revert NotForwarder(msg.sender);
        _checkWorkflow(metadata);

        (uint8 kind, bytes memory body) = abi.decode(report, (uint8, bytes));
        if (kind == REPORT_ALERT) {
            _recordAlert(body);
        } else if (kind == REPORT_COLLAPSE) {
            _recordCollapse(body);
        } else if (kind == REPORT_CLAIM_VERIFIED) {
            _recordClaimVerified(body);
        } else if (kind == REPORT_CLAIM_CUSTODY) {
            _recordClaimCustody(body);
        } else {
            revert UnknownReportKind(kind);
        }
    }

    /// @dev Metadata = abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    ///      (+ 2 bytes reportId on the production forwarder, so 64 bytes). Only checked when configured.
    function _checkWorkflow(bytes calldata metadata) private view {
        bytes32 wantId = expectedWorkflowId;
        address wantOwner = expectedWorkflowOwner;
        if (wantId == bytes32(0) && wantOwner == address(0)) return;
        if (metadata.length < 62) revert WrongWorkflow(bytes32(0), address(0));
        bytes32 workflowId = bytes32(metadata[0:32]);
        address workflowOwner = address(bytes20(metadata[42:62]));
        if ((wantId != bytes32(0) && workflowId != wantId) || (wantOwner != address(0) && workflowOwner != wantOwner)) {
            revert WrongWorkflow(workflowId, workflowOwner);
        }
    }

    function _recordAlert(bytes memory body) private {
        (bytes32 caseId, string memory symbol, address token, uint8 level, uint32 promoters, bytes32 trailHash) =
            abi.decode(body, (bytes32, string, address, uint8, uint32, bytes32));
        if (caseId == bytes32(0)) revert InvalidCaseId();
        if (level < LEVEL_SUSPICIOUS || level > LEVEL_COLLAPSED) revert InvalidLevel(level);

        CaseStatus storage c = _cases[caseId];
        bool isNew = c.alertAt == 0 && c.collapsedAt == 0 && c.claimCount == 0;
        // Idempotent: nothing new (same reasoning trail, no escalation) -> no-op, no revert.
        if (c.alertAt != 0 && c.trailHash == trailHash && level <= c.level) return;
        if (isNew) _caseIds.push(caseId);

        c.symbol = symbol;
        c.token = token;
        if (level > c.level) c.level = level;
        c.promoters = promoters;
        c.trailHash = trailHash;
        c.alertAt = uint64(block.timestamp);
        emit AlertRecorded(caseId, symbol, token, level, promoters, trailHash, uint64(block.timestamp));
    }

    function _recordCollapse(bytes memory body) private {
        (bytes32 caseId, address token, uint256 liquidityBefore, uint256 liquidityNow, uint16 dropBps) =
            abi.decode(body, (bytes32, address, uint256, uint256, uint16));
        if (caseId == bytes32(0)) revert InvalidCaseId();
        if (dropBps > 10_000) revert InvalidDrop(dropBps);

        CaseStatus storage c = _cases[caseId];
        // A collapse is recorded once; later reports for the same case are ignored.
        if (c.collapsedAt != 0) return;
        if (c.alertAt == 0 && c.claimCount == 0) _caseIds.push(caseId);

        if (c.token == address(0)) c.token = token;
        c.level = LEVEL_COLLAPSED;
        c.liquidityBefore = liquidityBefore;
        c.liquidityNow = liquidityNow;
        c.dropBps = dropBps;
        c.collapsedAt = uint64(block.timestamp);
        emit CollapseRecorded(caseId, token, liquidityBefore, liquidityNow, dropBps, uint64(block.timestamp));
    }

    /// @dev A claim the Chainlink network verified on Ethereum mainnet. Recorded once per (caseId, evidenceHash);
    ///      a repeat is a no-op (no revert), like the other report kinds. If the hotline relayer has not
    ///      anchored this evidence yet, the verified report anchors it too (so "verified" implies "anchored").
    function _recordClaimVerified(bytes memory body) private {
        (
            bytes32 caseId,
            bytes32 evidenceHash,
            bytes32 claimantRef,
            bytes32 walletRef,
            uint32 purchases,
            uint64 firstBuyBlock
        ) = abi.decode(body, (bytes32, bytes32, bytes32, bytes32, uint32, uint64));
        if (caseId == bytes32(0)) revert InvalidCaseId();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (purchases == 0) revert NoVerifiedPurchases();

        ClaimVerification storage v = _verifications[caseId][evidenceHash];
        if (v.at != 0) return;

        if (claimAnchoredAt[caseId][evidenceHash] == 0) _anchor(caseId, evidenceHash, claimantRef);
        v.claimantRef = claimantRef;
        v.walletRef = walletRef;
        v.purchases = purchases;
        v.firstBuyBlock = firstBuyBlock;
        v.at = uint64(block.timestamp);
        verifiedClaimCount[caseId] += 1;
        emit ClaimVerified(caseId, evidenceHash, claimantRef, purchases, firstBuyBlock, uint64(block.timestamp));
    }

    /// @dev Chain-of-custody for an anchored claim (canary-anchor workflow). Only for a claim that really is
    ///      anchored here; recorded once per (caseId, evidenceHash), a repeat is a no-op (no revert).
    function _recordClaimCustody(bytes memory body) private {
        CustodyReport memory r = abi.decode(body, (CustodyReport));
        if (r.caseId == bytes32(0)) revert InvalidCaseId();
        if (r.evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (r.level > LEVEL_COLLAPSED) revert InvalidLevel(r.level);
        if (claimAnchoredAt[r.caseId][r.evidenceHash] == 0) revert ClaimNotAnchored(r.caseId, r.evidenceHash);

        ClaimCustody storage k = _custody[r.caseId][r.evidenceHash];
        if (k.at != 0) return;
        k.anchorTx = r.anchorTx;
        k.anchorBlock = r.anchorBlock;
        k.level = r.level;
        k.trailHash = r.trailHash;
        k.collapsed = r.collapsed;
        k.verifiedPurchases = r.verifiedPurchases;
        k.poolLiquidityCents = r.poolLiquidityCents;
        k.mainnetBlock = r.mainnetBlock;
        k.at = uint64(block.timestamp);
        emit ClaimCustodyRecorded(
            r.caseId,
            r.evidenceHash,
            r.anchorTx,
            r.trailHash,
            r.level,
            r.poolLiquidityCents,
            r.mainnetBlock,
            uint64(block.timestamp)
        );
    }

    // ------------------------------------------------------------------
    // Victim claims (hotline relayer; or anchored by a verified CRE report above)
    // ------------------------------------------------------------------
    /// @notice Anchor the SHA-256 of a victim's evidence file to a case.
    /// @param claimantRef A salted hash that identifies the claimant inside Canary only. Never personal data.
    function anchorClaim(bytes32 caseId, bytes32 evidenceHash, bytes32 claimantRef) external {
        if (msg.sender != owner && !isRelayer[msg.sender]) revert NotRelayer(msg.sender);
        if (caseId == bytes32(0)) revert InvalidCaseId();
        if (evidenceHash == bytes32(0)) revert InvalidEvidenceHash();
        if (claimAnchoredAt[caseId][evidenceHash] != 0) revert ClaimAlreadyAnchored(caseId, evidenceHash);
        _anchor(caseId, evidenceHash, claimantRef);
    }

    function _anchor(bytes32 caseId, bytes32 evidenceHash, bytes32 claimantRef) private {
        CaseStatus storage c = _cases[caseId];
        if (c.alertAt == 0 && c.collapsedAt == 0 && c.claimCount == 0) _caseIds.push(caseId);
        c.claimCount += 1;
        claimAnchoredAt[caseId][evidenceHash] = uint64(block.timestamp);
        emit ClaimAnchored(caseId, evidenceHash, claimantRef, uint64(block.timestamp));
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    /// @notice Latest status of a case (all zero if unknown).
    function getCase(bytes32 caseId) external view returns (CaseStatus memory) {
        return _cases[caseId];
    }

    /// @notice Compact status for the workflow: level reached, last trail hash, collapsed?
    function statusOf(bytes32 caseId) external view returns (uint8 level, bytes32 trailHash, bool collapsed) {
        CaseStatus storage c = _cases[caseId];
        return (c.level, c.trailHash, c.collapsedAt != 0);
    }

    function isClaimAnchored(bytes32 caseId, bytes32 evidenceHash) external view returns (bool) {
        return claimAnchoredAt[caseId][evidenceHash] != 0;
    }

    /// @notice When the Chainlink network verified this claim (unix seconds), 0 if never.
    function claimVerifiedAt(bytes32 caseId, bytes32 evidenceHash) external view returns (uint64) {
        return _verifications[caseId][evidenceHash].at;
    }

    /// @notice Everything recorded about a verified claim (all zero if not verified).
    function getClaimVerification(bytes32 caseId, bytes32 evidenceHash)
        external
        view
        returns (ClaimVerification memory)
    {
        return _verifications[caseId][evidenceHash];
    }

    /// @notice The chain-of-custody record for an anchored claim (all zero if the canary-anchor workflow hasn't written one).
    function getClaimCustody(bytes32 caseId, bytes32 evidenceHash) external view returns (ClaimCustody memory) {
        return _custody[caseId][evidenceHash];
    }

    function caseCount() external view returns (uint256) {
        return _caseIds.length;
    }

    function caseIdAt(uint256 index) external view returns (bytes32) {
        return _caseIds[index];
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
