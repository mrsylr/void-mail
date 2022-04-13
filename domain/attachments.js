class Attachment {
    constructor(partId, name, type, subType, encoding, size) {
        this.partId = partId;
        this.name = name;
        this.type = type;
        this.subType = subType;
        this.encoding = encoding;
        this.size = size;
    }
    static create(partId, name, type, subType, encoding, size) {
        return new Attachment(partId, name, type, subType, encoding, size)
    }
}
module.exports = Attachment