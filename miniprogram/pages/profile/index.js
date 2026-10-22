const s = require('../_shared');
const neighborAreas = require('../../data/neighbor-areas');
const neighborLocation = require('../../data/neighbor-location');
const petData = require('../../data/pets');
const petTypes = petData.TYPES;
const petRows = (items, pending = []) => items.map(pet => ({ ...pet, typeName: (petTypes.find(type => type.id === pet.type) || {}).name || '其他动物', ageLabel: petData.ageLabel(pet), pendingPhoto: pending.find(item => item.petId === pet.id) || null }));
const neighborAreaChoices = [{ id: '', label: '选择公开活动片区' }].concat(neighborAreas);
s.register({
  data: { loading: true, error: '', mode: '', nickname: '', bio: '', areas: ['暂不填写'], areaIndex: 0, hasPet: false, petName: '', petTypes, petTypeIndex: 0, publicProfile: false, showPet: false, busy: false,
    pets: [], petEditorOpen: false, editingPetId: '', petDraftName: '', petDraftBreed: '', petDraftTypeIndex: 0, petAgeMode: 'unknown', petBirthDate: '', petAgeYears: '', petAgeMonths: '', petPhotoError: '', today: petData.today(),
    neighborVisible: false, neighborAreaChoices, neighborAreaIndex: 0, residenceSharing: false, residenceCell: null, residenceUpdatedAt: 0 },
  onLoad() { this.refresh(); },
  onUnload() { this._residenceRequest = (this._residenceRequest || 0) + 1; },
  refresh() {
    this._residenceRequest = (this._residenceRequest || 0) + 1;
    return s.load(this, async () => {
      const boot = await s.api.call('bootstrap'); const user = boot.user;
      this.userId = user.id;
      const areas = ['暂不填写'].concat(boot.settings.areas || []);
      if (user.area && !areas.includes(user.area)) areas.push(user.area);
      const neighborVisible = !s.personalMode && user.neighborVisible === true;
      let pending = [], petPhotoError = '';
      try { pending = await this.photoClient().pending(); } catch (error) { petPhotoError = error.message || '待处理宠物照片暂时无法读取'; }
      return { mode: boot.mode, publicProfile: !s.personalMode && user.publicProfile === true, showPet: !s.personalMode && user.showPet === true, avatar: user.avatar || '/assets/avatar-1.png', nickname: user.nickname || '', bio: user.bio || '', areas, areaIndex: Math.max(0, areas.indexOf(user.area)), hasPet: !!user.pet, petName: user.pet ? user.pet.name : '', petTypeIndex: user.pet ? Math.max(0, petTypes.findIndex(t => t.id === user.pet.type)) : 0,
        pets: petRows(petData.list(user), pending), petPhotoError, today: petData.today(),
        neighborVisible, neighborAreaIndex: Math.max(0, neighborAreaChoices.findIndex(area => area.id === user.neighborAreaId)),
        residenceSharing: neighborVisible && user.residenceSharing === true,
        residenceCell: neighborVisible && user.residenceSharing === true ? neighborLocation.normalizeCell(user.residenceCell) : null,
        residenceUpdatedAt: Number.isFinite(user.residenceUpdatedAt) ? user.residenceUpdatedAt : 0 };
    });
  },
  openPublicProfile() {
    if (!s.personalMode && !this.data.loading && !this.data.error && !this.data.busy && this.userId) s.go('/pages/author/index?userId=' + encodeURIComponent(this.userId));
  },
  input(e) { const key = e.currentTarget.dataset.field; if (key === 'petName') this._legacyPetEdited = true; if (['nickname', 'bio', 'petName', 'petDraftName', 'petDraftBreed', 'petAgeYears', 'petAgeMonths'].includes(key)) s.safe(this, { [key]: e.detail.value }); },
  selectArea(e) { s.safe(this, { areaIndex: Number(e.detail.value) }); },
  selectType(e) { this._legacyPetEdited = true; s.safe(this, { petTypeIndex: Number(e.detail.value) }); },
  petState(e) { if (!this.data.busy) { this._legacyPetEdited = true; const hasPet = e.currentTarget.dataset.value === 'yes'; s.safe(this, { hasPet, showPet: hasPet ? this.data.showPet : false }); } },
  photoClient() { if (!this._petPhotos) this._petPhotos = require('../../services/pet-photos').createPetPhotos(wx, s.api, require('../../config')); return this._petPhotos; },
  async applyPets(response) {
    const items = response.pets || [];
    let pending = [], petPhotoError = '';
    try { pending = await this.photoClient().pending(); } catch (error) { petPhotoError = error.message; }
    s.safe(this, { pets: petRows(items, pending), hasPet: items.length > 0, petName: items[0] && items[0].name || '', petPhotoError, ...(!items.length ? { showPet: false } : {}) });
  },
  editPet(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id || '', pet = this.data.pets.find(item => item.id === id);
    const currentAge = pet ? petData.monthsAt(pet) : null;
    if (!id && this.data.pets.length >= petData.MAX_PETS) return s.toast('最多登记 ' + petData.MAX_PETS + ' 只宠物');
    s.safe(this, { petEditorOpen: true, editingPetId: id, petDraftName: pet && pet.name || '', petDraftBreed: pet && pet.breed || '', petDraftTypeIndex: pet ? Math.max(0, petTypes.findIndex(type => type.id === pet.type)) : 0,
      petAgeMode: pet && pet.birthDate ? 'birthday' : currentAge !== null ? 'age' : 'unknown', petBirthDate: pet && pet.birthDate || '', petAgeYears: currentAge !== null ? String(Math.floor(currentAge / 12)) : '', petAgeMonths: currentAge !== null ? String(currentAge % 12) : '' });
  },
  closePetEditor() { if (!this.data.busy) s.safe(this, { petEditorOpen: false }); },
  selectPetType(e) { s.safe(this, { petDraftTypeIndex: Number(e.detail.value) }); },
  selectPetAgeMode(e) { s.safe(this, { petAgeMode: e.currentTarget.dataset.value }); },
  selectPetBirthday(e) { s.safe(this, { petBirthDate: e.detail.value }); },
  savePet() {
    return s.action(this, async () => {
      const type = petTypes[this.data.petDraftTypeIndex];
      const draft = { ...(this.data.editingPetId ? { id: this.data.editingPetId } : {}), name: this.data.petDraftName.trim(), type: type && type.id, breed: this.data.petDraftBreed.trim(), birthDate: this.data.petAgeMode === 'birthday' ? this.data.petBirthDate : '', ageMonths: null };
      if (this.data.petAgeMode === 'birthday' && !draft.birthDate) return s.toast('请选择生日，或选择暂不填写');
      if (this.data.petAgeMode === 'age') {
        if (!/^\d{1,3}$/.test(this.data.petAgeYears || '0') || !/^\d{1,2}$/.test(this.data.petAgeMonths || '0') || Number(this.data.petAgeMonths || 0) > 11) return s.toast('填写有效的岁数和 0–11 个月');
        draft.ageMonths = Number(this.data.petAgeYears || 0) * 12 + Number(this.data.petAgeMonths || 0);
      }
      petData.validate(draft, Date.now(), (code, message) => { throw new Error(message); });
      const result = await s.api.call('savePet', draft); await this.applyPets(result);
      s.safe(this, { petEditorOpen: false }); s.toast('宠物资料已保存');
    });
  },
  deletePet(e) {
    const petId = e.currentTarget.dataset.id;
    return s.action(this, async () => {
      if (!await s.confirm('移除这份宠物资料？', s.personalMode ? '会移除这只宠物的资料和专用照片，其他宠物与私人记录不受影响。' : '会移除这只宠物的资料和专用照片，其他宠物与分享不受影响。', '移除')) return;
      const result = await s.api.call('deletePet', { petId });
      try { await this.photoClient().discard(petId); } catch (_) { /* Account cleanup can retry residual local copies. */ }
      await this.applyPets(result); s.toast(result.cleanupPending ? '资料已移除，照片清理将继续重试' : '宠物资料已移除');
    });
  },
  petPhotoAction(e) {
    const petId = e.currentTarget.dataset.id, action = e.currentTarget.dataset.action;
    return s.action(this, async () => {
      try {
        if (action === 'remove') await s.api.call('setPetPhoto', { petId, ticketId: '' });
        else if (action === 'discard') await this.photoClient().discard(petId);
        else await this.photoClient()[action === 'retry' ? 'retry' : 'select'](petId);
      } finally { await this.applyPets(await s.api.call('listPets')); }
    });
  },
  petDisplayState(e) { if (!s.personalMode && !this.data.busy && this.data.hasPet) s.safe(this, { showPet: e.currentTarget.dataset.value === 'yes' }); },
  privacyState(e) { if (!s.personalMode && !this.data.busy) s.safe(this, { publicProfile: e.currentTarget.dataset.value === 'public' }); },
  neighborState(e) {
    if (s.personalMode || this.data.busy) return;
    const neighborVisible = e.currentTarget.dataset.value === 'yes';
    this._residenceRequest = (this._residenceRequest || 0) + 1;
    s.safe(this, { neighborVisible, ...(!neighborVisible ? { residenceSharing: false, residenceCell: null } : {}) });
  },
  selectNeighborArea(e) {
    if (s.personalMode) return;
    const index = Number(e.detail.value);
    if (!this.data.busy && Number.isInteger(index) && index >= 0 && index < neighborAreaChoices.length) s.safe(this, { neighborAreaIndex: index });
  },
  residenceState(e) {
    if (s.personalMode || this.data.busy || !this.data.neighborVisible) return;
    const residenceSharing = e.currentTarget.dataset.value === 'yes';
    this._residenceRequest = (this._residenceRequest || 0) + 1;
    s.safe(this, { residenceSharing, ...(!residenceSharing ? { residenceCell: null } : {}) });
  },
  chooseResidence() {
    if (s.personalMode || !this.data.neighborVisible || !this.data.residenceSharing || this.data.loading) return;
    return s.action(this, async () => {
      if (wx.__preview || typeof wx.chooseLocation !== 'function') return s.toast('请在微信小程序中手选居住位置，浏览器预览暂不支持');
      const request = this._residenceRequest = (this._residenceRequest || 0) + 1;
      let cell;
      try {
        cell = await new Promise((resolve, reject) => wx.chooseLocation({
          success: value => {
            try { resolve(neighborLocation.toCell({ latitude: value.latitude, longitude: value.longitude, coordinateSystem: 'gcj02' })); }
            catch (error) { reject(error); }
          }, fail: reject
        }));
      } catch (error) {
        if (this._closed || request !== this._residenceRequest || /cancel/i.test(String(error && (error.errMsg || error.message)))) return;
        throw new Error('暂时无法选择居住位置，请在微信中检查地图权限后重试');
      }
      if (this._closed || request !== this._residenceRequest || !this.data.neighborVisible || !this.data.residenceSharing) return;
      if (!cell) return s.toast('请选择上海范围内的居住位置');
      s.safe(this, { residenceCell: cell });
    });
  },
  save() {
    return s.action(this, async () => {
      const nickname = this.data.nickname.trim();
      if (!nickname) return s.toast('给自己起一个昵称吧');
      if (this._legacyPetEdited && this.data.hasPet && !this.data.petName.trim()) return s.toast('填写宠物名字，或选择暂不填写宠物');
      if (s.personalMode) {
        const payload = { nickname, bio: this.data.bio.trim(), area: this.data.areaIndex ? this.data.areas[this.data.areaIndex] : '',
          ...(this._legacyPetEdited ? { pet: this.data.hasPet ? { name: this.data.petName.trim(), type: petTypes[this.data.petTypeIndex].id } : null } : {}) };
        await s.api.call('updateProfile', payload);
        this._legacyPetEdited = false;
        if (!this._closed) { s.toast('私人资料已保存'); s.back(); }
        return;
      }
      const neighborAreaId = neighborAreaChoices[this.data.neighborAreaIndex] && neighborAreaChoices[this.data.neighborAreaIndex].id || '';
      if (this.data.neighborVisible && !neighborAreaId) return s.toast('选择一个愿意公开的活动片区');
      const residenceSharing = this.data.neighborVisible && this.data.residenceSharing;
      const residenceCell = residenceSharing ? neighborLocation.normalizeCell(this.data.residenceCell) : null;
      if (residenceSharing && !residenceCell) return s.toast('请先手选居住位置，或关闭居住距离展示');
      const payload = { nickname, publicProfile: this.data.publicProfile, showPet: this.data.hasPet && this.data.showPet, bio: this.data.bio.trim(), area: this.data.areaIndex ? this.data.areas[this.data.areaIndex] : '', ...(this._legacyPetEdited ? { pet: this.data.hasPet ? { name: this.data.petName.trim(), type: petTypes[this.data.petTypeIndex].id } : null } : {}),
        neighborVisible: this.data.neighborVisible, neighborAreaId, residenceSharing, residenceCell };
      await s.api.call('updateProfile', payload);
      this._legacyPetEdited = false;
      if (!this._closed) { s.toast('资料已保存'); s.back(); }
    });
  }
});
