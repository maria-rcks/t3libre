import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import * as changeApproval from '../../server/change-approval-engine.ts';

describe('Change Approval Engine', () => {
  beforeEach(() => {
    changeApproval.clearAllRequests();
  });

  it('evaluates destructive actions as requiring approval', () => {
    const policy = changeApproval.evaluatePolicy('delete', 'Delete production database', 'app-1');
    assert.equal(policy.requiresApproval, true);
    assert.equal(policy.severity, 'critical');
  });

  it('evaluates non-destructive actions on non-production as safe', () => {
    const policy = changeApproval.evaluatePolicy('restart', 'Restart development server', 'dev-app-1');
    assert.equal(policy.requiresApproval, true);
    assert.equal(policy.severity, 'high');
  });

  it('creates a change request', () => {
    const request = changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Scheduled maintenance', 'Restarting for updates');
    assert.equal(request.status, 'pending');
    assert.equal(request.userId, 'user-1');
    assert.equal(request.appId, 'app-1');
    assert.equal(request.isBreakGlass, false);
  });

  it('creates a break-glass request with emergency status', () => {
    const request = changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Emergency fix', 'Critical security patch', true);
    assert.equal(request.status, 'emergency');
    assert.equal(request.isBreakGlass, true);
  });

  it('approves a pending request', () => {
    const request = changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Test', 'Details');
    const approved = changeApproval.approveChangeRequest(request.id, 'user-2', 'Bob');
    assert.ok(approved);
    assert.equal(approved!.status, 'approved');
    assert.equal(approved!.reviewerName, 'Bob');
  });

  it('rejects a pending request', () => {
    const request = changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Test', 'Details');
    const rejected = changeApproval.rejectChangeRequest(request.id, 'user-2', 'Bob', 'Not approved');
    assert.ok(rejected);
    assert.equal(rejected!.status, 'rejected');
    assert.equal(rejected!.rejectReason, 'Not approved');
  });

  it('does not approve already processed requests', () => {
    const request = changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Test', 'Details');
    changeApproval.approveChangeRequest(request.id, 'user-2', 'Bob');
    const doubleApprove = changeApproval.approveChangeRequest(request.id, 'user-3', 'Charlie');
    assert.equal(doubleApprove, null);
  });

  it('lists change requests with filters', () => {
    changeApproval.createChangeRequest('user-1', 'Alice', 'app-1', 'restart', 'Test 1', 'Details');
    changeApproval.createChangeRequest('user-2', 'Bob', 'app-2', 'delete', 'Test 2', 'Details');
    const user1Requests = changeApproval.listChangeRequests({ userId: 'user-1' });
    assert.equal(user1Requests.length, 1);
    assert.equal(user1Requests[0].userName, 'Alice');
  });
});
