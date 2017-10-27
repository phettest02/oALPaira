const LineAPI = require('./api');
const { Message, OpType, Location } = require('../curve-thrift/line_types');
let exec = require('child_process').exec;

const myBot = ['u00f827ce6641038d7c9b6704a9777dfa','u894909fecf5a1c35d62c260bd02ab36e','u3b35ed7d2edb147bf94e557513018a39','u84b8ef2fbd11b7cc4e4c1b7bc3b0a61b','ue0d17a4a6bb31a73543bce45a8f6200d','u68eb5505b4e6347e891e796a42ccbae4','u4f8b073c5a5afefb66851dbae0d79362','u262bacc67316932b23b4f72a8c8905c5','u06f165bda65892f28c266dcfddc6f9c0','u00d8661acada5be74c0e2b45b26dd5db'];


function isAdminOrBot(param) {
    return myBot.includes(param);
}


class LINE extends LineAPI {
    constructor() {
        super();
        this.receiverID = '';
        this.checkReader = [];
        this.stateStatus = {
            kick: 0,
            cancel: 0,
            qr: 0,
        }
    }

    getOprationType(operations) {
        for (let key in OpType) {
            if(operations.type == OpType[key]) {
                if(key !== 'NOTIFIED_UPDATE_PROFILE') {
                    console.info(`[* ${operations.type} ] ${key} `);
                }
            }
        }
    }

    poll(operation) {
        if(operation.type == 25 || operation.type == 26) {
            // console.log(operation);
            const txt = (operation.message.text !== '' && operation.message.text != null ) ? operation.message.text : '' ;
            let message = new Message(operation.message);
            this.receiverID = message.to = (operation.message.to === myBot[0]) ? operation.message.from_ : operation.message.to ;
            Object.assign(message,{ ct: operation.createdTime.toString() });
            this.textMessage(txt,message);
        }

        if(operation.type == 13 && this.stateStatus.cancel == 1) {
            this.cancelAll(operation.param1);
        }

        if(operation.type == 11 && this.stateStatus.qr == 1) { //ada yg open/close url
            if(!isAdminOrBot(operation.param2)) {
                this._kickMember(operation.param1,[operation.param2]);
                this._updateGroup(operation.param1,[operation.param3]);
            }
        }


        if(operation.type == 15) { //admin left
            if(isAdminOrBot(operation.param2)) {
                this._inviteIntoGroup(operation.param1,[operation.param2]);
            }
        }

        if(operation.type == 19) { //ada kick
            // op1 = group nya
            // op2 = yang 'nge' kick
            // op3 = yang 'di' kick
            if(isAdminOrBot(operation.param3)) {
                this._inviteIntoGroup(operation.param1,[operation.param3]);
            }
            if(!isAdminOrBot(operation.param2)) {
                this._kickMember(operation.param1,[operation.param2]);
            }
        }

        if(operation.type == 32) {
            //op2 = yg ngecancel
            //op3 = yg dicancel
            if(isAdminOrBot(operation.param3)) {
                this._inviteIntoGroup(operation.param1,[operation.param3]);
            }
        }

        if(operation.type == 55){ //ada reader

            const idx = this.checkReader.findIndex((v) => {
                if(v.group == operation.param1) {
                    return v
                }
            })
            if(this.checkReader.length < 1 || idx == -1) {
                this.checkReader.push({ group: operation.param1, users: [operation.param2], timeSeen: [operation.param3] });
            } else {
                for (var i = 0; i < this.checkReader.length; i++) {
                    if(this.checkReader[i].group == operation.param1) {
                        if(!this.checkReader[i].users.includes(operation.param2)) {
                            this.checkReader[i].users.push(operation.param2);
                            this.checkReader[i].timeSeen.push(operation.param3);
                        }
                    }
                }
            }
        }

        if(operation.type == 13) { // diinvite
            if(isAdminOrBot(operation.param2)) {
                return this._acceptGroupInvitation(operation.param1);
            } else {
                return this._cancel(operation.param1,myBot);
            }
        }
        this.getOprationType(operation);
    }

    async cancelAll(gid) {
        let { listPendingInvite } = await this.searchGroup(gid);
        if(listPendingInvite.length > 0){
            this._cancel(gid,listPendingInvite);
        }
    }

    async searchGroup(gid) {
        let listPendingInvite = [];
        let thisgroup = await this._getGroups([gid]);
        if(thisgroup[0].invitee !== null) {
            listPendingInvite = thisgroup[0].invitee.map((key) => {
                return key.mid;
            });
        }
        let listMember = thisgroup[0].members.map((key) => {
            return { mid: key.mid, dn: key.displayName };
        });

        return { 
            listMember,
            listPendingInvite
        }
    }

    setState(seq) {
        if(isAdminOrBot(seq.from)){
            let [ actions , status ] = seq.text.split(' ');
            const action = actions.toLowerCase();
            const state = status.toLowerCase() == 'on' ? 1 : 0;
            this.stateStatus[action] = state;
            this._sendMessage(seq,`Status: \n${JSON.stringify(this.stateStatus)}`);
        } else {
            this._sendMessage(seq,`Kamu bukan admin.`);
        }
    }

    mention(listMember) {
        let mentionStrings = [''];
        let mid = [''];
        for (var i = 0; i < listMember.length; i++) {
            mentionStrings.push('@'+listMember[i].displayName+'\n\n');
            mid.push(listMember[i].mid);
        }
        let strings = mentionStrings.join('');
        let member = strings.split('@').slice(1);
        
        let tmp = 0;
        let memberStart = [];
        let mentionMember = member.map((v,k) => {
            let z = tmp += v.length + 1;
            let end = z - 1;
            memberStart.push(end);
            let mentionz = `{"S":"${(isNaN(memberStart[k - 1] + 1) ? 0 : memberStart[k - 1] + 1 ) }","E":"${end}","M":"${mid[k + 1]}"}`;
            return mentionz;
        })
        return {
            names: mentionStrings.slice(1),
            cmddata: { MENTION: `{"MENTIONEES":[${mentionMember}]}` }
        }
    }

    async leftGroupByName(payload) {
        let gid = await this._findGroupByName(payload);
        for (var i = 0; i < gid.length; i++) {
            this._leaveGroup(gid[i]);
        }
    }
    
    async check(cs,group) {
        let users;
        for (var i = 0; i < cs.length; i++) {
            if(cs[i].group == group) {
                users = cs[i].users;
            }
        }
        
        let contactMember = await this._getContacts(users);
        return contactMember.map((z) => {
                return { displayName: z.displayName, mid: z.mid };
            });
    }

    removeReaderByGroup(groupID) {
        const groupIndex = this.checkReader.findIndex(v => {
            if(v.group == groupID) {
                return v
            }
        })

        if(groupIndex != -1) {
            this.checkReader.splice(groupIndex,1);
        }
    }

    async textMessage(textMessages, seq) {
        let [ cmd, ...payload ] = textMessages.split(' ');
        payload = payload.join(' ');
        let txt = textMessages.toLowerCase();
        let messageID = seq.id;
        var group = await this._getGroup(seq.to);

        if(group.preventJoinByTicket == false && !isAdminOrBot(seq.from)) {
            group.preventJoinByTicket = true;
            await this._updateGroup(group);
        }

        if(cmd == '/cancel') {
            if(payload == 'group') {
                let groupid = await this._getGroupsInvited();
                for (let i = 0; i < groupid.length; i++) {
                    this._rejectGroupInvitation(groupid[i])                    
                }
                return;
            }

        if(txt == 'response' || txt == 'respon') {
            this._sendMessage(seq, '[A]ira');
        }

      	if(txt == 'keyword' || txt == 'help' || txt == 'key') {
	          this._sendMessage(seq, 'Belum ada keyword.');
      	}

        if(txt == '/speed') {
            const curTime = (Date.now() / 1000);
            await this._sendMessage(seq,'Dalam proses....');
            const rtime = (Date.now() / 1000) - curTime;
            await this._sendMessage(seq, `${rtime} detik.`);
        }

        if(txt === 'tes' && this.stateStatus.kick == 1 && isAdminOrBot(seq.from)) {
            let { listMember } = await this.searchGroup(seq.to);
            for (var i = 0; i < listMember.length; i++) {
                if(!isAdminOrBot(listMember[i].mid)) {
                    this._kickMember(seq.to,[listMember[i].mid])
                }
            }
        }

        if(txt == '/point') {
            this._sendMessage(seq, `Read point telah di set!`);
            this.removeReaderByGroup(seq.to);
        }

        if(txt == '/reset') {
            this.checkReader = []
            this._sendMessage(seq, `Read point telah di reset!`);
        }

      	if(txt == '/tagall' && isAdminOrBot (seq.from)) {
            let rec = await this._getGroup(seq.to);
            const mentions = await this.mention(rec.members);
   	    seq.contentMetadata = mentions.cmddata;
            await this._sendMessage(seq,mentions.names.join(''));
        }

        if(txt == '/check') {
            let rec = await this.check(this.checkReader,seq.to);
            const mentions = await this.mention(rec);
            seq.contentMetadata = mentions.cmddata;
            await this._sendMessage(seq,mentions.names.join(''));
        }

        const action = ['cancel on','cancel off','kick on','kick off','qr on','qr off']
        if(action.includes(txt)) {
            this.setState(seq);
        }

        if(txt == '/myid') {
            this._sendMessage(seq,`MID kamu: ${seq.from}`);
        }

        const joinByUrl = ['/open','/close'];
        if(joinByUrl.includes(txt) && isAdminOrBot (seq.from)) {
            let updateGroup = await this._getGroup(seq.to);
            updateGroup.preventJoinByTicket = true;
            if(txt == 'open' && isAdminOrBot (seq.from)) {
                updateGroup.preventJoinByTicket = false;
                const groupUrl = await this._reissueGroupTicket(seq.to);
                this._sendMessage(seq,`http://line.me/R/ti/g/${groupUrl}`);
            }
            await this._updateGroup(updateGroup);
        }

        if(cmd == '/join') { //untuk join group pake qrcode contoh: join line://anu/g/anu
            const [ ticketId ] = payload.split('g/').splice(-1);
            let { id } = await this._findGroupByTicket(ticketId);
            await this._acceptGroupInvitationByTicket(id,ticketId);
        }

        if(cmd == '/spm' && isAdminOrBot(seq.from)) { // untuk spam invite contoh: spm <mid>
            for (var i = 0; i < 4; i++) {
                let { group } = this._createGroup('spam',[payload]);
                let { memid } = this._getContacts(mid);
                this._inviteIntoGroup(group,memid);
            }
        }

        if(cmd == '/spamtext' && isAdminOrBot(seq.from)) { // untuk spam invite contoh: spm <mid>
            for (var i = 0; i < 100; i++) {
                this._sendMessage(seq,'spam');
            }
        }

        if(cmd == '/lirik') {
            let lyrics = await this._searchLyrics(payload);
            this._sendMessage(seq,lyrics);
        }

        if(seq.contentType == 13) {
            seq.contentType = 0;
            this._sendMessage(seq,seq.contentMetadata.mid);
        }

        if(cmd == '/ig') {
            let { userProfile, userName, bio, media, follow } = await this._searchInstagram(payload);
            await this._sendFileByUrl(seq,userProfile);
            await this._sendMessage(seq, `${userName}\n\nBIO:\n${bio}\n\n\uDBC0 ${follow} \uDBC0`)
            if(Array.isArray(media)) {
                for (let i = 0; i < media.length; i++) {
                    await this._sendFileByUrl(seq,media[i]);
                }
            } else {
                this._sendMessage(seq,media);
            }
        }

        if(txt == '/left' && isAdminOrBot(seq.from)) {
            this._leaveGroup(seq.to);
        }

    }

}

module.exports = new LINE();
